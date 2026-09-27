// shader-lib.js — the shared GLSL preamble every fragment-shader scene is built on.
// Two exported string constants: VERTEX (a fixed clip-space vertex shader) and
// COMMON (uniform declarations + hash/noise/fbm helpers + a finish() grade).
// scenes.js does `COMMON + themeFragment` before handing the source to three.js,
// so a theme module only ever ships its own unique main().

// The vertex shader is deliberately trivial. We draw a single PlaneGeometry(2, 2)
// quad (see scenes.js) that already spans the whole -1..1 clip cube, so we can skip
// the model/view/projection matrices entirely and pass position straight through.
// We forward `uv` (0..1 across the quad) as vUv so the fragment shader has a stable
// screen coordinate. z = 0, w = 1 keeps every fragment on the near plane; combined
// with depthTest/depthWrite off in the material, the quad is a guaranteed full-frame
// canvas for the fragment shader to paint.
export const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// COMMON is prepended to every theme fragment. It sets precision, redeclares the
// varying, and lists every uniform the host might feed a scene. A given theme's
// main() uses whichever subset it needs; unused uniforms are harmless.
export const COMMON = /* glsl */ `
  // highp float everywhere: the noise/fbm math accumulates small values over many
  // octaves and banding shows up fast at mediump on some GPUs.
  precision highp float;
  varying vec2 vUv;

  // Screen size in pixels — used to correct aspect ratio and to scale grain by
  // actual fragment coordinates rather than UV.
  uniform vec2  uResolution;
  // Seconds since scene start. The host advances this every frame; all motion in
  // the shaders is driven by it (multiplied by uSpeed per scene).
  uniform float uTime;

  // The five palette slots, as linear RGB 0..1 (config.js hexToRgb converts from
  // the hex strings in palettes.js). Names are thematic, not positional: void is
  // the deep background, tide/verdant/iris are mid aurora bands, frost is the
  // bright tip / star colour. apply() in scenes.js can hot-swap these live.
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;

  // Aurora shaping knobs, all authored per-theme in scenes-meta / theme-catalog:
  //   uIntensity — overall brightness multiplier of the curtain
  //   uSpeed     — time multiplier, so one slider retunes the whole animation
  //   uHeight    — how far up the screen the curtain reaches
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uHeight;

  // Horizon band: uHorizonY is where the "ground" line sits in UV space,
  // uHorizonGlow is the strength of the light bloom along it, uReflection is how
  // much of the sky is mirrored below it (fake water).
  uniform float uHorizonY;
  uniform float uHorizonGlow;
  uniform float uReflection;

  // Starfield: uStars is density (higher = more sparse cells lit), uTwinkle is
  // how hard they pulse with uTime.
  uniform float uStars;
  uniform float uTwinkle;

  // Post-grade, applied by finish() below. uGrain is film-grain amplitude,
  // uVignette is edge darkening strength.
  uniform float uGrain;
  uniform float uVignette;

  // fbm loop count. GLSL ES 2.0 can't loop on a non-constant bound, so fbm()
  // always writes a fixed "for (i less-than 8)" loop and breaks early once
  // i reaches uOctaves. scenes.js clamps this to 1..8 so the break is reachable.
  uniform int   uOctaves;

  // hash21: cheap 2D -> 1D pseudo-random in 0..1. The fract/dot shuffle is a
  // well-worn GLSL trick (no sin, no texture lookup) — good enough for noise
  // seeding and grain, not for anything cryptographic. Same input always gives
  // the same output, which is what makes the value-noise below stable frame to
  // frame.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // vnoise: classic value noise. Hash the four integer lattice corners around p,
  // then bilinearly blend them. u = f*f*(3-2f) is the smoothstep (Hermite)
  // curve — it eases the interpolation so cell boundaries don't show as sharp
  // creases the way raw linear mixing would.
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // fbm: fractional Brownian motion — stack octaves of vnoise at doubling
  // frequency and halving amplitude to get natural-looking turbulence (this is
  // what gives the aurora its wispy structure). The 2x2 rot matrix rotates the
  // domain between octaves so the lattice grid of each layer lands at a different
  // angle and you don't see axis-aligned repetition. 2.03 (not exactly 2.0)
  // detunes the frequency step for the same reason. Loop is capped at 8; the
  // early break honours uOctaves for cheaper themes.
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      sum += amp * vnoise(p);
      p = rot * p * 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  // finish: the shared post-grade every scene calls right before gl_FragColor.
  // 1) Vignette — darken toward the corners. length(uv - 0.5) is distance from
  //    centre; *1.42 pushes the falloff so it bites near the edges, pow(...,2.4)
  //    keeps the middle clean, and uVignette scales the whole effect. clamp to
  //    0..1 so a strong setting can't invert the colour.
  // 2) Grain — add per-pixel noise seeded on gl_FragCoord (real pixels, so grain
  //    size is resolution-independent) plus fract(uTime)*137 so it re-rolls every
  //    frame and reads as moving film grain, not a static dither. The -0.5
  //    centres it around zero; the +1/255 floor guarantees at least one LSB of
  //    dithering even when uGrain is 0, which kills 8-bit banding in dark
  //    gradients.
  // 3) max(col, 0.0) — grain can push a channel negative; clamp the low end so it
  //    doesn't wrap or NaN downstream.
  vec3 finish(vec3 col, vec2 uv) {
    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.4), 0.0, 1.0);
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain + 1.0 / 255.0);
    return max(col, 0.0);
  }
`;
