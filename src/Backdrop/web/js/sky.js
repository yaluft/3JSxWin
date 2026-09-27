// sky.js — the Aurora scene (createSky), Backdrop's default wallpaper.
// The aurora curtain: one full-screen quad, one draw call, no post-processing.
// Everything you see above and below the horizon comes out of this fragment shader.
//
// Why this file stands apart from the other scenes: every scene in scenes.js is
// also "one quad, one draw call", but those glue COMMON (from shader-lib.js) onto
// a small theme main() and share createShaderBackdrop(). Aurora is old enough and
// central enough that it carries its OWN copy of the vertex shader, the hash/noise/
// fbm helpers, and the finish grade inline — so it has no COMMON dependency and
// can't be broken by an edit to the shared preamble. The uniform set and the
// apply()/update()/dispose() shape are deliberately kept identical to the shader
// scenes so scenes.js and the on-scene panel treat it like any other backdrop.

import * as THREE from 'three';
import { hexToRgb } from './config.js';

// Same trivial clip-space vertex shader every scene uses: we draw a PlaneGeometry(2, 2)
// that already fills the -1..1 clip cube, so there is no model/view/projection matrix
// to apply — just pass position straight through and forward uv (0..1 across the quad)
// as vUv for the fragment shader to use as a screen coordinate.
const VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  // highp everywhere: the fbm below sums many small octaves and a dark, wide sky
  // gradient bands visibly at mediump on a lot of GPUs.
  precision highp float;

  varying vec2 vUv;

  // Screen size in pixels — used for aspect correction and to size the star grid /
  // grain in real pixels rather than UV.
  uniform vec2  uResolution;
  // Seconds since scene start; the host advances it every frame and all motion is
  // driven by it (scaled by uSpeed).
  uniform float uTime;

  // The five palette slots as linear RGB 0..1 (config.js hexToRgb converts the hex
  // strings from palettes.js). Names are thematic, not positional: void is the deep
  // background, tide is the low band just above the horizon, verdant/iris are the
  // aurora's mid colours, frost is the bright tip and star colour. apply() can
  // hot-swap all five while the scene runs.
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;

  // Shaping knobs, authored per-theme (scenes-meta / theme-catalog) and adjustable
  // live from the panel:
  //   uIntensity   — overall brightness of the curtain
  //   uSpeed       — time multiplier, so one slider retunes the whole animation
  //   uHeight      — how far up the screen the curtain reaches (also the colour ramp scale)
  //   uHorizonY    — where the horizon line sits in UV space (0 = bottom, 1 = top)
  //   uHorizonGlow — strength of the light bloom along that line
  //   uReflection  — how much of the curtain is mirrored below the horizon (fake water)
  //   uStars       — star density (higher = more cells lit)
  //   uTwinkle     — how hard the stars pulse with uTime
  //   uGrain       — film-grain amplitude in the final dither
  //   uVignette    — corner-darkening strength
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uHeight;
  uniform float uHorizonY;
  uniform float uHorizonGlow;
  uniform float uReflection;
  uniform float uStars;
  uniform float uTwinkle;
  uniform float uGrain;
  uniform float uVignette;
  // fbm octave count. GLSL ES 2.0 can't loop on a non-constant bound, so fbm()
  // always writes "for (i < 8)" and breaks once i >= uOctaves. createSky clamps
  // this to 1..8 so the break is always reachable.
  uniform int   uOctaves;

  // hash21: cheap 2D -> 1D pseudo-random in 0..1. The fract/dot shuffle is a
  // well-worn GLSL trick — no sin, no texture lookup. Same input always gives the
  // same output, which is what makes the value noise below stable frame to frame.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // vnoise: classic value noise. Hash the four integer lattice corners around p and
  // bilinearly blend them; u = f*f*(3-2f) is the smoothstep curve that eases the
  // interpolation so cell edges don't show as creases.
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

  // fbm: fractional Brownian motion — stack octaves of vnoise at doubling frequency
  // and halving amplitude to get natural turbulence; this is what gives the aurora
  // its wispy structure. The 2x2 rot matrix turns the domain between octaves so each
  // layer's lattice lands at a different angle and you don't see axis-aligned
  // repetition; 2.03 (not exactly 2.0) detunes the frequency step for the same
  // reason. Loop capped at 8, early break honours uOctaves for cheaper themes.
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

  // curtain: one aurora sheet in "sky space" — p.x is horizontal, p.y is height
  // above the horizon (0 = right at the horizon line). Returns an energy value the
  // caller turns into colour. Four things stacked:
  //  1. warp/q — push the sample point around with two fbm channels so the sheet
  //     ripples and folds instead of being a straight band. Time drifts one axis,
  //     the seed offsets the other so each stacked curtain folds differently.
  //  2. streak/shape — a low-frequency fbm thresholded with smoothstep gives the
  //     soft-edged vertical body of the sheet.
  //  3. rays — a high-frequency 1D noise across x adds the fine vertical striations.
  //     Those rays are the thing that reads as "aurora" and not "flame" or "smoke".
  //  4. rise/foot — exp falloff with height (tied to uHeight) fades the top out;
  //     the foot smoothstep hides the hard bottom edge just above the horizon.
  float curtain(vec2 p, float t, float seed) {
    vec2 warp = vec2(
      fbm(p * 1.7 + vec2(t * 0.19, seed * 3.1)),
      fbm(p * 1.3 + vec2(seed * 7.7, t * 0.13))
    );
    vec2 q = p + (warp - 0.5) * 2.2;

    float streak = fbm(vec2(q.x * 1.6 + t * 0.31 + seed * 11.0, q.y * 0.55 - t * 0.07));
    float shape  = smoothstep(0.40, 0.88, streak);

    // Vertical rays are what separates an aurora from a flame.
    float rays = 0.5 + 0.5 * vnoise(vec2(q.x * 12.0 + seed * 5.0, t * 0.4));

    float rise = exp(-max(p.y, 0.0) / max(uHeight, 0.02));
    float foot = smoothstep(0.0, 0.05, p.y);

    return shape * rise * foot * rays;
  }

  // auroraColor: map (height above horizon, local energy) to a colour. Low sheets
  // are verdant, tall ones shade toward iris (real auroras go green low, red/violet
  // high), and the brightest cores blow out toward frost. Feeding a different height
  // for the reflection (below) is how the mirrored copy gets a slightly different tint.
  vec3 auroraColor(float height, float energy) {
    vec3 c = mix(uVerdant, uIris, smoothstep(0.0, uHeight * 1.05, height));
    return mix(c, uFrost, smoothstep(0.55, 1.05, energy) * 0.4);
  }

  void main() {
    vec2  uv     = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t      = uTime * uSpeed;

    // Sky space keeps x square, so curtains do not smear on an ultrawide.
    // y is measured from the horizon (uHorizonY), so y > 0 is sky, y < 0 is ground.
    vec2 sky = vec2((uv.x - 0.5) * aspect, uv.y - uHorizonY);

    // Background gradient: tide near the horizon fading up to void at the top of the
    // sky, then a second darken toward pure void going down below the horizon.
    vec3 col = mix(uTide, uVoid, smoothstep(-0.25, 0.95, sky.y));
    col = mix(col, uVoid * 0.75, smoothstep(0.0, -0.5, sky.y));

    // --- stars ------------------------------------------------------------
    // Chop the screen into ~4px pixel cells. Each cell gets one deterministic seed
    // from hash21; step() lights the cell only if its seed clears the uStars
    // threshold (so higher uStars => more cells pass). jit nudges the star off the
    // cell centre so the field doesn't look like a grid, point is a soft round dot,
    // flick is the per-star twinkle (each on its own phase and rate). The final
    // smoothstep on sky.y keeps stars in the sky and off the ground.
    vec2  grid = uv * uResolution / 4.0;
    vec2  cell = floor(grid);
    float seed = hash21(cell);
    float lit  = step(1.0 - uStars * 0.010, seed);
    vec2  jit   = vec2(hash21(cell + 3.7), hash21(cell + 9.1));
    float point = smoothstep(0.34, 0.0, length(fract(grid) - jit));
    float flick = 1.0 - uTwinkle * 0.5 * (1.0 + sin(uTime * (1.3 + seed * 3.0) + seed * 40.0));
    col += uFrost * lit * point * max(flick, 0.0) * smoothstep(-0.01, 0.45, sky.y) * 0.85;

    // --- aurora -----------------------------------------------------------
    // Sum four curtains at different scales, offsets, seeds and time rates. Layering
    // is the whole trick: one curtain is a flat sheet, four overlapping ones with
    // incommensurate speeds read as a deep, folding, never-quite-repeating aurora.
    // The scale factors (1.45, 0.78, 0.55) put some sheets nearer and some further;
    // the weights (0.62..0.35) keep the extra layers as accents on the main one.
    float energy = curtain(sky, t, 0.0)
                 + curtain(sky * 1.45 + vec2(2.3, 0.0), t * 1.27, 1.0) * 0.62
                 + curtain(sky * 0.78 - vec2(1.7, 0.0), t * 0.71, 0.44) * 0.44
                 + curtain(sky * 0.55 + vec2(5.1, 0.0), t * 0.43, 2.7) * 0.35;
    energy *= uIntensity;
    col += auroraColor(sky.y, energy) * energy;

    // --- the signature: a lit horizon and its damped reflection ------------
    // This mirrored-water look is what makes the scene recognisably "Aurora" rather
    // than a generic sky. below is how far under the horizon this fragment is.
    float below = max(-sky.y, 0.0);

    if (uReflection > 0.001) {
      // Two sine ripples across x displace the mirrored sample so the reflection
      // shimmers like it is on moving water instead of a flat mirror.
      float wobble = sin(uv.x * 26.0 + uTime * 0.55) * 0.012
                   + sin(uv.x * 61.0 - uTime * 0.31) * 0.005;
      // Sample the curtains again at a flipped, scaled-down y (below * 1.5, then
      // *0.85) so the reflection sits lower and reads as foreshortened.
      vec2  mirror = vec2(sky.x + wobble, below * 1.5) * 0.85;
      float refl = curtain(mirror, t, 0.0) * 0.9
                 + curtain(mirror * 1.45 + vec2(2.3, 0.0), t * 1.27, 1.0) * 0.5;
      // exp(-below * 7.5) fades the reflection out fast with depth — real water
      // reflections lose contrast quickly — and uReflection scales the whole thing.
      refl *= uIntensity * uReflection * exp(-below * 7.5);
      col += auroraColor(below * 0.4, refl) * refl;
    }

    // Horizon glow. breath is a slow global pulse so the light never sits perfectly
    // still; footGlow is a moving fbm along x so the brightness varies across the
    // horizon; edgeFade darkens the far left/right so the glow doesn't run off the
    // screen edges. line is a very tight exp spike (*460) = the bright hairline
    // itself; the second term (*22) is the wide soft bloom sitting under it.
    float breath = 0.74 + 0.26 * sin(uTime * 0.27);
    float footGlow = smoothstep(0.32, 0.88, fbm(vec2(sky.x * 3.4 + t * 0.31, -t * 0.07)));
    float edgeFade = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x);

    float line = exp(-abs(sky.y) * 460.0) * (0.22 + 0.78 * footGlow) * edgeFade;
    col += mix(uFrost, uVerdant, 0.35) * line * uHorizonGlow * breath * 0.6;
    col += mix(uVerdant, uFrost, 0.4) * exp(-abs(sky.y) * 22.0) * uHorizonGlow * footGlow * 0.2;

    // --- finish -----------------------------------------------------------
    // Same two-step post-grade the shared finish() does, inlined here. First the
    // vignette: darken toward the corners (length from centre, *1.42 to bite near
    // the edge, pow 2.4 to keep the middle clean), clamped so a strong setting can't
    // invert the colour.
    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.4), 0.0, 1.0);

    // Then dither: add per-pixel noise seeded on real fragment coords (so grain size
    // is resolution-independent) plus fract(uTime)*137 so it re-rolls every frame and
    // reads as moving film grain. The +1/255 floor guarantees at least one LSB of
    // dither even at uGrain 0 — without it a gradient this dark and this wide bands
    // badly on the 8-bit write.
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain + 1.0 / 255.0);

    // max(col, 0.0): grain can push a channel negative; clamp the low end so it
    // doesn't wrap or NaN. Alpha 1 — the wallpaper is fully opaque.
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

// createSky: build the Aurora scene object. Returns the same { scene, camera,
// setSize, setOctaves, apply, update, dispose } shape as createShaderBackdrop in
// scenes.js, so the renderer and the panel drive it exactly like any other scene.
// config is the resolved theme config (palette + the aurora/horizon/stars/finish/
// render sub-objects that feed the uniforms above).
export function createSky(config) {
  const { palette, aurora, horizon, stars, finish, render } = config;

  // One uniform object, mutated in place for the life of the scene. THREE keeps a
  // live reference, so writing uniforms.uX.value later (in apply/update/setSize) is
  // all it takes to push a change to the GPU next frame — no recompile.
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVoid: { value: new THREE.Vector3(...hexToRgb(palette.void)) },
    uTide: { value: new THREE.Vector3(...hexToRgb(palette.tide)) },
    uVerdant: { value: new THREE.Vector3(...hexToRgb(palette.verdant)) },
    uIris: { value: new THREE.Vector3(...hexToRgb(palette.iris)) },
    uFrost: { value: new THREE.Vector3(...hexToRgb(palette.frost)) },
    uIntensity: { value: aurora.intensity },
    uSpeed: { value: aurora.speed },
    uHeight: { value: aurora.height },
    uHorizonY: { value: horizon.y },
    uHorizonGlow: { value: horizon.glow },
    uReflection: { value: horizon.reflection },
    uStars: { value: stars.density },
    uTwinkle: { value: stars.twinkle },
    uGrain: { value: finish.grain },
    uVignette: { value: finish.vignette },
    // Clamp octaves to 1..8: the shader loop is fixed at 8 with an "i >= uOctaves"
    // break, so a value outside that range would either never break or run forever.
    // `| 0` floors the float to an int for the `uniform int`.
    uOctaves: { value: Math.min(Math.max(render.octaves | 0, 1), 8) },
  };

  // depthTest/depthWrite off: there is exactly one full-screen quad and nothing to
  // occlude, so skip the depth buffer entirely. The material is opaque (no
  // transparent:true) because the fragment shader always writes alpha 1.
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // An identity camera: the vertex shader already writes clip space, so we never
  // need a projection. A bare THREE.Camera (no perspective/ortho) leaves the
  // view/projection matrices as identity, which is exactly what we want here.
  const camera = new THREE.Camera();

  return {
    scene,
    camera,
    // Called on start and on every window/monitor resize. The shader only needs the
    // pixel size (for aspect + grain/star scaling); there is no camera to reshape.
    setSize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    // The renderer lowers octaves when the frame budget is tight and raises them
    // when there's headroom. Same 1..8 clamp as construction.
    setOctaves(count) {
      uniforms.uOctaves.value = Math.min(Math.max(count | 0, 1), 8);
    },
    // Live control from the on-scene panel. Mirrors the config shape; unknown keys
    // are ignored so the panel and the shader can evolve independently. Every field
    // is null-checked so the panel can send just the one value that changed.
    apply(cfg) {
      const p = cfg.palette;
      if (p) {
        if (p.void) uniforms.uVoid.value.set(...hexToRgb(p.void));
        if (p.tide) uniforms.uTide.value.set(...hexToRgb(p.tide));
        if (p.verdant) uniforms.uVerdant.value.set(...hexToRgb(p.verdant));
        if (p.iris) uniforms.uIris.value.set(...hexToRgb(p.iris));
        if (p.frost) uniforms.uFrost.value.set(...hexToRgb(p.frost));
      }
      const a = cfg.aurora;
      if (a) {
        if (a.intensity != null) uniforms.uIntensity.value = a.intensity;
        if (a.speed != null) uniforms.uSpeed.value = a.speed;
        if (a.height != null) uniforms.uHeight.value = a.height;
      }
      const h = cfg.horizon;
      if (h) {
        if (h.y != null) uniforms.uHorizonY.value = h.y;
        if (h.glow != null) uniforms.uHorizonGlow.value = h.glow;
        if (h.reflection != null) uniforms.uReflection.value = h.reflection;
      }
      const s = cfg.stars;
      if (s) {
        if (s.density != null) uniforms.uStars.value = s.density;
        if (s.twinkle != null) uniforms.uTwinkle.value = s.twinkle;
      }
      const f = cfg.finish;
      if (f) {
        if (f.grain != null) uniforms.uGrain.value = f.grain;
        if (f.vignette != null) uniforms.uVignette.value = f.vignette;
      }
    },
    // Called once per frame by the renderer with total elapsed seconds. This is the
    // only per-frame CPU work the scene does — everything else is on the GPU.
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    // Called when the scene is torn down (theme switch, window close). The geometry
    // is a shared PlaneGeometry(2,2) that three.js can reuse, so only the material
    // (which owns the compiled shader program) needs freeing here.
    dispose() {
      material.dispose();
    },
  };
}
