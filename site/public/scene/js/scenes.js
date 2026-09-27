// scenes.js — the scene registry. Holds the GLSL fragment shader for every built-in
// wallpaper (the *SCII tube demos, ION, GLYPHFALL) and the createScene() dispatch that
// the renderer calls to build one. Aurora lives in its own file (sky.js); this file
// glues the rest together and owns the "next scene" ordering for the Win+arrow hotkeys.
//
// The whole design premise: each scene is ONE full-screen quad, ONE draw call, the same
// five-color palette (void / tide / verdant / iris / frost), no framebuffer ping-pong
// on the plain shader path. That keeps GPU cost low enough to run forever as a desktop
// background. The ASCII scenes add exactly one extra offscreen pass (see ascii.js).

import * as THREE from 'three';
import { hexToRgb } from './config.js';
import { createSky } from './sky.js';
// ASCII_GBUFFER is the shared shader preamble every density-ASCII scene prepends;
// ASCII_SCENE_IDS says which ids get the two-pass ASCII treatment; createAsciiBackdrop
// builds that two-pass pipeline. The ?v=4 is the cache-buster (see note on FRAGMENTS
// dispatch below) — WebView2 caches modules hard, so bump the integer when ascii.js changes.
import { ASCII_GBUFFER, ASCII_SCENE_IDS, createAsciiBackdrop } from './ascii.js?v=4';
// Re-export the id list and metadata so callers can `import { SCENE_IDS } from './scenes.js'`
// and not care that the actual source is scenes-meta.js. We also need SCENE_IDS locally.
export { SCENE_IDS, SCENE_META, visibleSceneIds, HIDDEN_IDS } from './scenes-meta.js';
import { SCENE_IDS, visibleSceneIds } from './scenes-meta.js';
// VERTEX is the trivial clip-space vertex shader (just passes uv through); COMMON is the
// palette + noise/fbm + finish() preamble that the non-ASCII shaders prepend before compile.
// Theme modules ship only their unique main(), so the host is responsible for gluing COMMON on.
import { VERTEX, COMMON } from './shader-lib.js';

// ── TERRASCII ("Tube Dunes") ────────────────────────────────────────────────
// A raymarched field of horizontal cylinders laid over a scrolling dune surface,
// then run through the density-ASCII compositor. We build the shader by string-
// concatenating ASCII_GBUFFER (the shared preamble: precision, uniforms, hash/fbm,
// rot2, asciiLit) in front of this scene-specific body. This body ends with a
// main() that writes a G-buffer texel: RGB = lit colour, A = luminance. Pass 2 in
// ascii.js turns that luminance into a glyph. Nothing here draws a character.
const TERRASCII = ASCII_GBUFFER + /* glsl */ `
  // Landscape of horizontal tubes riding a dune field — same ASCII pass as the tube demo.

  // Dune height at a point: two octaves of fbm, each scrolling on a different axis
  // and speed so the field never visibly repeats or "breathes" in lockstep.
  float terrainH(vec2 p, float t) {
    return fbm(p * 0.55 + vec2(t * 0.18, 0.0)) * 0.7
         + fbm(p * 1.6 - vec2(0.0, t * 0.11)) * 0.28;
  }

  // Signed distance to an infinite cylinder running along X: only the y/z offset
  // from the axis matters, so distance is just the 2D radial distance minus radius.
  float sdCylX(vec3 p, float r) {
    return length(p.yz) - r;
  }

  // The scene SDF. We domain-repeat along Z: floor(p.z/spacing) picks which tube row
  // we're near (idz), and lz is the position within that row's slot. Each row sits at
  // the dune height for its Z, plus a travelling sine ripple, so the tubes undulate.
  // The +0.02*sin(idz) just gives each row a slightly different thickness.
  float mapField(vec3 p, float t) {
    float spacing = 0.28;
    float idz = floor(p.z / spacing);
    float lz = p.z - (idz + 0.5) * spacing;
    float h = terrainH(vec2(p.x, idz * spacing), t);
    float wave = 0.06 * sin(p.x * 3.2 + idz * 0.7 - t * 2.4);
    return sdCylX(vec3(p.x, p.y - h - wave, lz), 0.07 + 0.02 * sin(idz));
  }

  // Surface normal by central-ish differences: sample the SDF nudged along each axis
  // and the gradient points "uphill" out of the surface. Standard raymarch trick —
  // cheaper than deriving an analytic normal for a domain-repeated field.
  vec3 fieldNormal(vec3 p, float t) {
    vec2 e = vec2(0.02, 0.0);
    float h = mapField(p, t);
    return normalize(vec3(
      mapField(p + e.xyy, t) - h,
      mapField(p + e.yxy, t) - h,
      mapField(p + e.yyx, t) - h
    ));
  }

  void main() {
    // uSpeed (a config knob) scales the base time rate, so "slower motion" in the
    // settings actually slows every scene without touching the shader math.
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.22 + uSpeed * 1.8);
    // Screen uv -> centered, aspect-corrected plane coords. The -0.38 (not -0.5)
    // tilts the framing so the horizon sits above centre — more sky, less floor.
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.38);

    // Camera flies along +X (ro.x = t*1.15); ray direction fans out from the pixel.
    vec3 ro = vec3(t * 1.15, 0.85, 0.1);
    vec3 rd = normalize(vec3(p.x, p.y - 0.12, 1.15));
    // Sphere-tracing loop: step forward by the SDF value (clamped so we neither
    // overshoot thin tubes nor crawl), stop when we're basically on a surface or
    // we've gone far enough that it's all fog anyway.
    float dAcc = 0.05;
    float hit = -1.0;
    for (int i = 0; i < 56; i++) {
      float d = mapField(ro + rd * dAcc, t);
      if (d < 0.008) { hit = dAcc; break; }
      dAcc += clamp(d, 0.01, 0.28);
      if (dAcc > 18.0) break;
    }

    // Miss = empty texel. Alpha 0 tells the ASCII pass "no glyph here" so the
    // background shows through instead of a stray character.
    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Cheap directional lighting: diffuse (N·L), a tight specular lobe via the
    // reflected sun vector, and exponential distance fog. asciiLit() folds all
    // four terms into a palette colour + a single luminance for the glyph ramp.
    vec3 pos = ro + rd * hit;
    vec3 nrm = fieldNormal(pos, t);
    vec3 sun = normalize(vec3(0.55, 0.65, 0.2));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.85);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 22.0);
    float fog = exp(-hit * 0.07);
    gl_FragColor = asciiLit(diff, spec, fog, 0.0);
  }
`;

// ── WARPSCII ("Tube Warp") ──────────────────────────────────────────────────
// You fly down the axis of a cylindrical tunnel whose wall is made of 14 rails of
// beads arranged around the ring. Same ASCII_GBUFFER preamble, same G-buffer output
// contract as TERRASCII. Only the SDF and camera path differ.
const WARPSCII = ASCII_GBUFFER + /* glsl */ `
  // A ring of instanced tubes you fly through — same density ASCII as the tube demo.

  // Rounded-box SDF collapsed to a capped cylinder along Z (radius r, half-length h).
  // Present for completeness of the tube kit; mapTunnel below uses a plain sphere.
  float sdCylZ(vec3 p, float r, float h) {
    vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  // Tunnel SDF. Convert the pixel's xy into an angle, snap that angle to the nearest
  // of n=14 rails (ia = which rail), and rebuild the rail's direction vector. rad is
  // the rail's distance from the axis, pulsing with a Z+time wave so the tunnel
  // ripples. Then domain-repeat the rail along Z (mod 0.48) into a string of beads,
  // and return distance to the nearest bead sphere.
  float mapTunnel(vec3 p, float t) {
    float n = 14.0;
    float ang = atan(p.y, p.x);
    float slice = 6.2831853 / n;
    float ia = floor(ang / slice + 0.5);
    float a = ia * slice;
    vec2 dir = vec2(cos(a), sin(a));
    float rad = 0.88 + 0.10 * sin(p.z * 2.0 - t * 3.2 + ia);
    vec3 q = p - vec3(dir * rad, 0.0);
    q.z = mod(q.z + 20.0, 0.48) - 0.24;
    return length(q) - (0.075 + 0.02 * sin(ia + t));
  }

  // Gradient normal, same finite-difference trick as TERRASCII with a smaller epsilon
  // because the beads are small and a coarse step would smear the shading.
  vec3 tunNormal(vec3 p, float t) {
    vec2 e = vec2(0.012, 0.0);
    float h = mapTunnel(p, t);
    return normalize(vec3(
      mapTunnel(p + e.xyy, t) - h,
      mapTunnel(p + e.yxy, t) - h,
      mapTunnel(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.35 + uSpeed * 2.4);
    // Centered framing (vUv - 0.5) this time — we're looking straight down the barrel.
    vec2 p2 = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

    // Camera sits on the axis and moves straight into +Z; that forward motion is the
    // whole "warp" effect. Ray fans out toward the pixel.
    vec3 ro = vec3(0.0, 0.0, t * 2.2);
    vec3 rd = normalize(vec3(p2, 1.2));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 64; i++) {
      float d = mapTunnel(ro + rd * dAcc, t);
      if (d < 0.007) { hit = dAcc; break; }
      dAcc += clamp(d, 0.008, 0.25);
      if (dAcc > 12.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Same lighting recipe as TERRASCII (diff + tight spec + fog), just a cooler sun
    // direction so the palette leans blue-green rather than gold.
    vec3 pos = ro + rd * hit;
    vec3 nrm = tunNormal(pos, t);
    vec3 sun = normalize(vec3(0.2, 0.55, 0.7));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.8);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 26.0);
    float fog = exp(-hit * 0.08);
    gl_FragColor = asciiLit(diff, spec, fog, 0.0);
  }
`;

// ── ION ("Ion") ─────────────────────────────────────────────────────────────
// The one built-in that is NOT ASCII and NOT raymarched: a pure 2D field-line
// painting. It prepends COMMON (not ASCII_GBUFFER) and writes a finished opaque
// RGB pixel straight to gl_FragColor — no G-buffer, no second pass. This is the
// "plain shader" path (see createShaderBackdrop / the FRAGMENTS dispatch below).
const ION = COMMON + /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * uSpeed * 0.7;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    // Dipole field: two poles on a slow orbit. For a 2D dipole, the field-line
    // value at a point is the difference of the bearing angles to the two poles —
    // so 'field' below is constant along any real field line, which is why banding
    // it with sin() draws the lines.
    vec2 a = vec2(sin(t * 0.31), cos(t * 0.27)) * 0.42;
    vec2 b = -a * 0.85;
    vec2 da = p - a;
    vec2 db = p - b;
    float fa = atan(da.y, da.x);
    float fb = atan(db.y, db.x);
    float field = fa - fb;

    // Turn the smooth field value into thin bright ribbons: sin() bands it, then
    // pow(1-x, big) keeps only the razor edge where the band crosses zero. uHeight
    // adds more bands, uIntensity scales overall brightness — both are config knobs.
    float lines = abs(sin(field * (5.0 + uHeight * 6.0)));
    float ribbon = pow(1.0 - lines, 10.0);
    ribbon += pow(1.0 - abs(sin(field * 2.0 + t)), 18.0) * 0.5;
    ribbon *= uIntensity;

    // Bright core glow at each pole, falling off exponentially with distance.
    float poleA = exp(-length(da) * 18.0);
    float poleB = exp(-length(db) * 18.0);

    // Composite in palette order: dark void→tide gradient base, verdant + iris on the
    // ribbons (iris weighted toward +x so the two halves aren't identical), frost at
    // the poles. uHorizonGlow is reused here as the pole-brightness knob.
    vec3 col = mix(uVoid, uTide, 0.45 + 0.2 * sin(field));
    col += uVerdant * ribbon * 0.85;
    col += uIris * ribbon * (0.35 + 0.65 * smoothstep(-1.0, 1.0, p.x));
    col += uFrost * (poleA + poleB) * uHorizonGlow;

    // Fast charged streaks along the field: quantise field+time into a grid, hash it,
    // and only ~7% of cells (step 0.93) light up, gated by uTwinkle (the stars knob).
    float streak = hash21(vec2(floor(field * 12.0), floor(t * 2.0)));
    col += uFrost * step(0.93, streak) * ribbon * uTwinkle;

    // finish() (from COMMON) applies the shared vignette + film grain and clamps.
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// ── BLOBSCII ("Tube Loops") ─────────────────────────────────────────────────
// Three thin tori (rings) tumbling on independent axes, raymarched and ASCII'd.
// Same preamble + G-buffer contract as the other *SCII scenes.
const BLOBSCII = ASCII_GBUFFER + /* glsl */ `
  // Three looping tubes (torus knots) — same density ASCII as the tube demo.

  // Torus SDF: t.x = ring radius (centre of tube to centre of hole), t.y = tube
  // thickness. Collapse to the 2D distance from the ring circle, then subtract t.y.
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  // Union of three tori. Each gets its own pair of rot2() rotations applied to the
  // sample point before the SDF (rotating the space is how you rotate the object),
  // with different speeds/phases so they drift apart. min() = boolean union of SDFs.
  float mapLoops(vec3 p, float t) {
    vec3 a = p;
    a.yz *= rot2(t * 0.41);
    a.xz *= rot2(t * 0.23);
    float d = sdTorus(a, vec2(0.72, 0.085));

    vec3 b = p;
    b.xy *= rot2(t * 0.33 + 1.1);
    b.yz *= rot2(0.9);
    d = min(d, sdTorus(b, vec2(0.58, 0.07)));

    vec3 c = p;
    c.xz *= rot2(-t * 0.29);
    c.xy *= rot2(1.2 + 0.2 * sin(t));
    d = min(d, sdTorus(c, vec2(0.46, 0.06)));
    return d;
  }

  // Gradient normal, same finite-difference trick as the other tube scenes.
  vec3 loopNormal(vec3 p, float t) {
    vec2 e = vec2(0.012, 0.0);
    float h = mapLoops(p, t);
    return normalize(vec3(
      mapLoops(p + e.xyy, t) - h,
      mapLoops(p + e.yxy, t) - h,
      mapLoops(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.24 + uSpeed * 1.7);
    vec2 p2 = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

    // Fixed camera pulled back on +Z looking toward -Z (rd.z is negative); the rings
    // spin in place rather than the camera flying, so nothing scrolls off-screen.
    vec3 ro = vec3(0.0, 0.15, 2.55);
    vec3 rd = normalize(vec3(p2, -1.35));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 64; i++) {
      float d = mapLoops(ro + rd * dAcc, t);
      if (d < 0.006) { hit = dAcc; break; }
      dAcc += clamp(d, 0.006, 0.22);
      if (dAcc > 7.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Lighting adds a rim term here (4th asciiLit arg): pow(1 - N·view, k) lights the
    // silhouette edge, which reads well on thin rings. fog is passed as 1.0 (off) —
    // the rings are close and we want them crisp.
    vec3 pos = ro + rd * hit;
    vec3 nrm = loopNormal(pos, t);
    vec3 sun = normalize(vec3(0.5, 0.7, 0.4));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.8);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 30.0);
    float rim = pow(1.0 - clamp(dot(nrm, -rd), 0.0, 1.0), 2.4);
    gl_FragColor = asciiLit(diff, spec, 1.0, rim);
  }
`;

// ── GLYPHFALL ("Glyphfall") ─────────────────────────────────────────────────
// The Matrix-rain scene. It uses the ASCII pipeline but does NO 3D at all: the
// G-buffer pass 1 already runs one fragment per grid cell (ascii.js renders into a
// tiny cols×rows target), so gl_FragCoord.xy IS the cell coordinate and we just
// compute a per-cell rain luminance directly. Cheapest scene in the set.
const GLYPHFALL = ASCII_GBUFFER + /* glsl */ `
  // Falling-glyph cascade. The G-buffer is already one cell per fragment,
  // so each pixel is one rain drop / trail sample — no raymarch, no tubes.
  void main() {
    vec2 uv = vUv;
    float t = uTime * (0.32 + uSpeed * 2.0);
    // Integer cell coordinates. Each column falls independently; hashing 'col'
    // gives that column its fixed speed / length / liveness.
    float col = floor(gl_FragCoord.x);
    float row = floor(gl_FragCoord.y);

    // Two overlaid rain layers (near + far) for depth. Per layer:
    //   seed  – stable random for this column+layer
    //   spd   – fall speed; cells – strand length
    //   y     – 0 at the strand head, →1 down the tail (fract makes it wrap)
    //   trail – brightness fade along the tail
    //   h     – sharp bright spike at the head
    //   live  – kills ~16% of columns so it isn't a solid wall
    //   tick  – per-cell flicker so glyphs look like they're changing
    float lum = 0.0;
    float head = 0.0;
    for (int layer = 0; layer < 2; layer++) {
      float lf = float(layer);
      float seed = hash21(vec2(col + lf * 17.0, 3.1 + lf));
      float spd = 0.55 + seed * 1.35 + lf * 0.28;
      float cells = 9.0 + seed * 12.0;
      float y = fract((row / max(cells, 1.0)) - t * spd + seed * 6.0);
      float trail = pow(1.0 - y, 1.65 + lf * 0.4);
      float h = exp(-y * (16.0 + lf * 8.0));
      float live = step(0.16 - lf * 0.04, seed);
      float tick = 0.5 + 0.5 * hash21(vec2(col, floor(row + t * spd * cells)));
      lum += trail * live * tick * (0.62 - lf * 0.18);
      head = max(head, h * live);
    }

    lum *= uIntensity;
    // Quiet the usual desktop-icon column so labels stay readable.
    // Icons live down the left edge, so fade the leftmost ~16% of the screen way
    // down; also dim the top half so the rain reads as "raining down into" the desk.
    lum *= mix(0.07, 1.0, smoothstep(0.0, 0.16, uv.x));
    lum *= mix(0.55, 1.0, uv.y);

    // Below threshold = empty cell (alpha 0, no glyph).
    if (lum < 0.025) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Feed the ASCII lighter: tail brightness as "diffuse", head spike as "specular"
    // and a bit of rim, fog off. asciiLit maps that onto the palette + glyph ramp.
    float diff = clamp(lum, 0.0, 1.0);
    float spec = head * 0.9;
    gl_FragColor = asciiLit(diff, spec, 1.0, head * 0.35);
  }
`;

// id -> compiled fragment source. createScene() looks scenes up here by id. Keys
// must match CORE_IDS in scenes-meta.js and (for the ASCII ones) ASCII_SCENE_IDS.
const FRAGMENTS = {
  terrascii: TERRASCII,
  warpscii: WARPSCII,
  ion: ION,
  blobscii: BLOBSCII,
  glyphfall: GLYPHFALL,
};

// Builds the "plain shader" backdrop: one ShaderMaterial on a 2×2 clip-space quad,
// rendered once per frame straight to the screen. Used for ION and for optional
// theme modules. The ASCII scenes take the parallel createAsciiBackdrop() path
// instead (two passes, a render target, the glyph atlas).
//
// The returned object is the contract the renderer drives: { scene, camera,
// setSize, setOctaves, apply, update, dispose } — plus prerender() on the ASCII
// variant. Keep these two builders' return shapes in sync.
function createShaderBackdrop(fragment, config) {
  const { palette, aurora, horizon, stars, finish, render } = config;

  // Every uniform the COMMON preamble declares, seeded from config. Colours are
  // pushed as vec3 in 0..1 (hexToRgb keeps it linear — no gamma surprises). This
  // block mirrors the identical one in ascii.js::createAsciiBackdrop; if you add a
  // uniform to COMMON / ASCII_GBUFFER you must add it in BOTH places.
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
    // fbm() loops up to 8 times but bails at `i >= uOctaves`, so this is the live
    // detail/perf dial. Clamped 1..8; adaptive-quality lowers it under load.
    uOctaves: { value: Math.min(Math.max(render.octaves | 0, 1), 8) },
  };

  // depthTest/Write off: it's a single full-screen quad, there's nothing to occlude,
  // and skipping the depth buffer is one less thing for the GPU to touch every frame.
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false,
  });

  // The 2×2 plane exactly covers clip space because VERTEX ignores the projection
  // and writes position.xy straight through — so a default (identity) Camera is fine.
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.Camera();

  return {
    scene,
    camera,
    // Renderer calls this on resize. The shader only needs pixel dimensions (for
    // aspect correction); the quad itself never changes size.
    setSize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    // Adaptive-quality hook: renderer dials octaves down when it's missing frame budget.
    setOctaves(count) {
      uniforms.uOctaves.value = Math.min(Math.max(count | 0, 1), 8);
    },
    // Live config patch (from the console UI or a hot-reloaded config.json). Only the
    // keys present in cfg are touched, so a partial patch leaves everything else alone.
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
    // Per-frame tick: `elapsed` is seconds since start. Every scene's animation is a
    // pure function of uTime, so there's no other per-frame state to advance.
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    // Free the GPU program when switching scenes. Geometry (the shared 2×2 plane) and
    // the identity camera are cheap enough to let GC handle.
    dispose() {
      material.dispose();
    },
  };
}

// The dispatch. Given a scene id (and optionally a loaded theme module), return the
// backdrop object the renderer will drive. Four cases, in priority order:
//   1. themeMod.fragment  – an installed optional theme: its main() glued onto COMMON,
//                           plain-shader path.
//   2. id === 'aurora'    – the hand-written sky.js scene.
//   3. ASCII scene        – id is in ASCII_SCENE_IDS AND we have a fragment for it:
//                           two-pass density-ASCII pipeline.
//   4. plain scene        – any other id we have a fragment for (currently just ion).
// Unknown id falls back to 'aurora' up front; a *failed theme load* deliberately does
// NOT — see the console.warn below.
export function createScene(name, config, themeMod = null) {
  if (themeMod?.fragment) return createShaderBackdrop(COMMON + themeMod.fragment, config);
  const id = SCENE_IDS.includes(name) ? name : 'aurora';
  if (id === 'aurora') return createSky(config);
  if (ASCII_SCENE_IDS.has(id) && FRAGMENTS[id]) return createAsciiBackdrop(FRAGMENTS[id], config, id);
  if (FRAGMENTS[id]) return createShaderBackdrop(FRAGMENTS[id], config);
  // Optional theme failed to load: do not silently paint Aurora while the UI
  // still says the theme name. Sky only when the id is actually aurora.
  // (We reach here when SCENE_IDS lists an installed theme id but its module never
  // provided a fragment — better to log and show *something* than to lie in the UI.)
  console.warn('createScene: no shader for', name);
  return createSky(config);
}

// Cycle to the next (delta +1) or previous (delta -1) scene id, wrapping around.
// This is what the Win+Left / Win+Right hotkeys call. SCENE_IDS is the *active* list
// (core scenes, plus any installed optional themes prepended by the theme catalog),
// so the cycle automatically includes installed themes. An unknown `current` starts
// the walk from index 0.
export function nextSceneId(current, delta = 1) {
  // Cycle over the VISIBLE list only, so Win+scroll never lands on a hidden
  // preset. If the current scene is itself hidden (e.g. the app fell back to
  // aurora after a theme failed), indexOf returns -1 and Math.max pins us to 0,
  // so the next step moves into the visible set rather than getting stuck.
  const ids = visibleSceneIds();
  const index = Math.max(0, ids.indexOf(current));
  return ids[(index + delta + ids.length) % ids.length];
}
