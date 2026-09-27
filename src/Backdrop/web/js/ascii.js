// ascii.js — the shared "ASCII" post-process rig used by every -scii scene
// (terrascii, warpscii, blobscii, glyphfall). It is a classic deferred /
// G-buffer setup squeezed onto two full-screen quads: pass 1 renders the scene
// into a tiny offscreen target (one texel per character cell), pass 2 reads that
// target back and stamps a monospace glyph into each cell, its density picked
// from the cell's brightness. The look is the font-atlas ASCII shader from
// https://offscreencanvas.com/renders/webgl-ascii/ .
//
// Why a G-buffer at all: we don't want to shade at full pixel resolution and
// then throw most of it away. We shade at *grid* resolution (e.g. 160x90 cells),
// so the expensive fbm/noise in the scene shader runs a few thousand times per
// frame instead of a few million — a wallpaper has to stay off the CPU/GPU
// meter. The per-cell data (colour + luminance) is the "geometry buffer" that
// the composite pass consumes.

import * as THREE from 'three';
import { hexToRgb } from './config.js';

// ASCII_SETS = number of glyph rows in the atlas (we only ship one ramp).
// ASCII_LEVELS = glyphs per ramp = number of distinct brightness buckets a cell
// can land in. 32 is enough to read as smooth shading without a huge atlas.
export const ASCII_SETS = 1;
export const ASCII_LEVELS = 32;

// The density ramp: 32 characters ordered dark -> bright. Index 0 is a space
// (pure background), index 31 is a solid block. The middle is hand-tuned by the
// *visual* weight of each glyph in a monospace font, not by ASCII value — 'c'
// covers less ink than 'a', 'a' less than '#', and so on. The composite shader
// picks a glyph by `floor(luminance * 32)`, so this ordering IS the tone curve.
const SETS = [
  [
    ' ', '.', '`', '\'', ':', '-', '~', '+',
    '=', '*', 'c', 'o', 'x', 'z', 'n', 'u',
    'v', 'a', 'h', 'k', 'b', 'd', '#', '%',
    '&', '8', '@', 'W', 'M', 'B', '$', '█',
  ],
];

// Size of one glyph cell inside the atlas texture, in atlas pixels. 2:3-ish
// portrait because monospace characters are taller than wide; picking a
// generous size keeps the rasterised glyph crisp when the atlas is sampled with
// LinearFilter at odd scales.
const CELL_W = 64;
const CELL_H = 96;

// Built once and reused by every scene. The atlas is pure function of the glyph
// list + font, so there is no reason to rasterise it per scene or per resize.
let sharedAtlas = null;

// Rasterise the density ramp into a single wide texture: ASCII_LEVELS glyphs
// laid out left-to-right in one row. The composite shader indexes into it by
// column. We do this on a 2D canvas (the browser's font renderer is far better
// than anything we'd hand-roll in GLSL) and upload the result as a texture.
export function getGlyphAtlas() {
  if (sharedAtlas) return sharedAtlas;

  // One long strip: width = one cell per glyph, height = one row per set.
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * ASCII_LEVELS;
  canvas.height = CELL_H * ASCII_SETS;
  const ctx = canvas.getContext('2d');

  // Black ground, white ink. The shader only reads the red channel and treats it
  // as "how much glyph is here" (0 = background, 1 = solid ink), so the actual
  // colour is irrelevant as long as it's grayscale — white on black is just the
  // cleanest mask to sample.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Bold weight (700) so thin glyphs still deposit enough ink to survive the
  // linear downsample. Cascadia/Consolas first because they're the Windows
  // monospace faces most likely to be installed; the block char '█' is drawn as
  // a filled rect instead of text so it's a guaranteed full cell on any font.
  ctx.font = `700 ${Math.floor(CELL_H * 0.72)}px "Cascadia Mono","Consolas","Courier New",monospace`;

  SETS.forEach((row, y) => {
    row.forEach((ch, x) => {
      // Centre of cell (x, y). The 0.54 (not 0.5) nudges glyphs down a hair to
      // optically centre them — monospace metrics leave more space below the
      // baseline than above.
      const cx = (x + 0.5) * CELL_W;
      const cy = (y + 0.54) * CELL_H;
      if (ch === '█') {
        ctx.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H);
      } else {
        ctx.fillText(ch, cx, cy);
      }
    });
  });

  const tex = new THREE.CanvasTexture(canvas);
  // flipY = false: we compute atlas UVs by hand in the shader and want texel
  // (0,0) at the top-left, the same way the 2D canvas laid it out. Letting three
  // flip it would put row 0 at the bottom and every glyph lookup would be wrong.
  tex.flipY = false;
  // No mipmaps: the atlas is only ever sampled at roughly 1:1, and mip chains on
  // a glyph strip bleed neighbouring characters into each other at distance.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // Clamp both axes so sampling right at a cell edge can't wrap around and pull
  // in the glyph from the opposite end of the strip.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  sharedAtlas = tex;
  return tex;
}

// The one vertex shader both passes share. It ignores the camera entirely and
// writes clip-space positions straight from the quad's geometry (a
// PlaneGeometry(2,2) already spans -1..1), so the quad always fills the viewport
// no matter what the Camera is doing. vUv carries the 0..1 screen coordinate
// down to the fragment shader.
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ASCII_VERTEX = VERTEX;

// ASCII_GBUFFER — the GLSL prelude every -scii scene shader pastes at the top of
// its own fragment shader. It declares the full uniform set the host feeds
// (resolution, time, the five palette colours, aurora/horizon/star/finish
// tunables, octave count) plus the shared noise toolkit (hash, value noise,
// fbm, 2D rotation). A scene shader then adds its own body and, at the end,
// returns an asciiCell()/asciiLit() vec4 — see below.
export const ASCII_GBUFFER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;
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
  uniform int   uOctaves;

  // Cheap hash -> pseudo-random float in 0..1 from a 2D point. The magic
  // constants are just irrational-ish numbers that decorrelate the bits; this is
  // the standard "hash without sine" trick (works the same on every GPU, unlike
  // sin()-based hashes which drift between drivers).
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Value noise: hash the four integer lattice corners around p and smoothly
  // interpolate. u = f*f*(3-2f) is the smoothstep / Hermite ease so the noise
  // has a continuous first derivative (no visible grid creases).
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(1.0, 1.0));
    float d = hash21(i + vec2(0.0, 1.0));
    return mix(mix(a, b, u.x), mix(d, c, u.x), u.y);
  }

  // Fractal Brownian motion: sum octaves of value noise, each half the amplitude
  // and roughly double the frequency of the last. The rotation matrix twists the
  // domain between octaves so the layers don't line up into obvious axis-aligned
  // streaks. The loop is a fixed 8 with an early break because GLSL ES wants a
  // constant loop bound — uOctaves (host-controlled quality knob) does the real
  // cut-off, letting a slow GPU drop to 2-3 octaves.
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

  // Standard 2D rotation matrix, for scenes that need to spin their domain.
  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  // The G-buffer packing convention. A scene shader's last line is
  // gl_FragColor = asciiCell(colour, luminance); — RGB carries the tint the
  // composite pass will paint the glyph with, and ALPHA carries the brightness
  // that picks WHICH glyph. Alpha is floored to 0.02 (never fully 0) so a lit
  // pixel is always distinguishable from "nothing here" (alpha < ~0.015), which
  // the composite pass uses to draw bare background.
  vec4 asciiCell(vec3 col, float lum) {
    return vec4(max(col, 0.0), clamp(lum, 0.02, 1.0));
  }

  // Convenience lighting model for the scenes that want one (terrascii's
  // terrain, blobscii's blobs): fold diffuse + specular + rim + a little ambient
  // into a single luminance, then walk the palette from tide -> verdant with
  // diffuse and toward iris/frost as the highlight climbs. fog is a 0..1
  // distance fade applied to both colour and luminance so far cells go dim (and
  // thus get sparser glyphs). Returns a ready-to-write asciiCell().
  vec4 asciiLit(float diff, float spec, float fog, float rim) {
    float lum = clamp(diff * 0.88 + spec * 0.55 + rim * 0.22 + 0.1, 0.0, 1.0) * fog;
    vec3 col = mix(uTide, uVerdant, clamp(diff, 0.0, 1.0));
    col = mix(col, uIris, clamp(spec * 0.55 + rim * 0.4, 0.0, 1.0));
    col = mix(col, uFrost, clamp(spec + rim * 0.25, 0.0, 1.0));
    return asciiCell(col * fog, lum);
  }
`;

// COMPOSITE — pass 2. Runs at full screen resolution. For each output pixel it
// works out which character CELL it falls in, reads that cell's single G-buffer
// texel, picks a glyph from the atlas by brightness, and draws the glyph's ink
// over the "paper" background. Template literals splice ASCII_LEVELS in as a
// GLSL float constant (32.0) so the ramp size lives in one place.
const COMPOSITE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uGBuffer;   // pass-1 target: rgb = tint, a = luminance
  uniform sampler2D uAtlas;     // the glyph strip from getGlyphAtlas()
  uniform vec2  uResolution;
  uniform vec2  uGrid;          // cells across x cells down — set by resizeGrid()
  uniform float uTime;
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;
  uniform float uIntensity;
  uniform float uGrain;
  uniform float uVignette;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    // Which cell are we in, and where inside that cell (0..1). mid is the
    // centre of the cell — we always sample the G-buffer at cell centres so
    // every pixel of a given cell reads the exact same texel (that's what makes
    // the output look blocky/quantised instead of smoothly interpolated).
    vec2 grid = max(uGrid, vec2(1.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;

    vec4 data = texture2D(uGBuffer, mid);
    // "Paper": the near-black ground the glyphs sit on, a very dark tint of the
    // void colour so it still reads as part of the palette.
    vec3 paper = uVoid * 0.12;
    // Empty cell (scene wrote nothing here). Just draw vignetted paper and bail
    // — no glyph lookup, no tint math.
    if (data.a < 0.015) {
      vec3 empty = paper;
      empty *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.8), 0.0, 1.0);
      gl_FragColor = vec4(max(empty, 0.0), 1.0);
      return;
    }

    // Brightness -> ramp index. floor(lum * 32) gives 0..31, the column of the
    // glyph in the atlas. lum is clamped just below 1 so the very brightest
    // cells don't round up to level 32 (off the end of the strip).
    float lum = clamp(data.a, 0.0, 0.999);
    float level = floor(lum * ${ASCII_LEVELS}.0);
    // pad insets the sample a little inside the glyph cell (local*0.88 + 0.06),
    // leaving a ~6% gutter between characters so adjacent glyphs don't touch and
    // smear. The solid block at the top of the ramp is exempt — it's meant to
    // fill the whole cell edge to edge.
    vec2 pad = local * 0.88 + 0.06;
    if (level > ${ASCII_LEVELS - 2}.5) pad = local;
    // Atlas UV: X walks to column level then across the glyph by pad.x; Y is
    // flipped (1.0 - pad.y) because the atlas was uploaded with flipY = false.
    vec2 atlasUV = vec2(
      (level + pad.x) / ${ASCII_LEVELS}.0,
      1.0 - pad.y
    );
    float ink = texture2D(uAtlas, atlasUV).r;   // 0 = gap, 1 = inside the glyph

    // Tint the ink with the cell colour from the G-buffer, but normalise it
    // first: divide by its own brightest channel so hue survives even when the
    // scene colour was very dark, then rescale by uIntensity. Mix a little frost
    // in as a floor so glyphs never go pure black-on-black.
    vec3 tint = max(data.rgb, vec3(0.04));
    float peak = max(tint.r, max(tint.g, tint.b));
    tint *= (0.55 + 0.7 * uIntensity) / max(peak, 0.08);
    vec3 inkCol = mix(uFrost * 0.35, tint, 0.92);
    // Lay the ink over the paper by glyph coverage.
    vec3 col = mix(paper, inkCol, ink);

    // Shared finish: radial vignette (darken toward the corners) and a touch of
    // per-pixel, per-frame grain so flat regions don't band on an 8-bit panel.
    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.8), 0.0, 1.0);
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain * 0.45 + 1.0 / 255.0);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

// Per-scene grid tuning. cellPx = target on-screen size of one character in CSS
// pixels (smaller -> more, finer glyphs); minCols/maxCols clamp the column count
// so the effect holds up from a laptop panel to a 4K span. glyphfall wants
// chunkier cells (8px) because its falling characters need to be individually
// readable; the terrain/warp/blob scenes read as texture so they can go denser.
export const ASCII_DEFAULTS = {
  terrascii: { cellPx: 6, minCols: 80, maxCols: 480 },
  warpscii: { cellPx: 6, minCols: 80, maxCols: 480 },
  blobscii: { cellPx: 6, minCols: 80, maxCols: 480 },
  glyphfall: { cellPx: 8, minCols: 64, maxCols: 360 },
};

// The set main.js checks to decide "is this scene one of the ASCII ones?".
export const ASCII_SCENE_IDS = new Set(Object.keys(ASCII_DEFAULTS));

// Work out the character grid (columns x rows) for the current viewport.
// Columns come from CSS width / cellPx, clamped to the scene's min/max. Rows are
// derived from columns times the aspect ratio times 0.55 — the 0.55 is the
// cell's height:width ratio inverted-ish, i.e. it accounts for character cells
// being taller than they are wide, so the glyphs come out roughly square on
// screen rather than stretched. This is the "column cap" that keeps the offscreen
// target tiny no matter the display.
function gridFor(width, height, ascii) {
  // Prefer CSS pixels (window.innerWidth) over the backing-store width so the
  // glyph size is stable regardless of devicePixelRatio / render scale.
  const cssW = window.innerWidth || width;
  const cols = Math.floor(Math.min(Math.max(cssW / Math.max(ascii.cellPx, 4), ascii.minCols), ascii.maxCols));
  const rows = Math.max(18, Math.floor(cols * (height / Math.max(width, 1)) * 0.55));
  return [Math.max(8, cols), rows];
}

// Factory: builds a complete two-pass ASCII backdrop for one scene. `gbufferFragment`
// is that scene's fragment shader (its body pasted after ASCII_GBUFFER); `config`
// is the merged config object; `sceneId` selects the ASCII_DEFAULTS row. Returns
// an object with the same shape main.js expects from every scene module: scene,
// camera, prerender, setSize, apply, update, dispose (+ setOctaves).
export function createAsciiBackdrop(gbufferFragment, config, sceneId) {
  const { palette, aurora, horizon, stars, finish, render } = config;
  // Scene grid settings: defaults, overridden by anything in config.ascii[sceneId].
  const ascii = { ...ASCII_DEFAULTS[sceneId], ...config.ascii?.[sceneId] };
  const atlas = getGlyphAtlas();

  // --- Pass 1 (G-buffer) uniforms. The scene shader reads these to shade each cell.
  const gUniforms = {
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
    // octave count clamped 1..8 — the fixed loop bound in fbm() is 8.
    uOctaves: { value: Math.min(Math.max(render.octaves | 0, 1), 8) },
  };

  // Pass-1 material: the scene shader on a full-screen quad. Depth off (nothing
  // to occlude, it's one quad) and NoBlending because we want the shader's exact
  // output written into the target, not alpha-composited over whatever's there.
  const gMaterial = new THREE.ShaderMaterial({
    uniforms: gUniforms,
    vertexShader: VERTEX,
    fragmentShader: gbufferFragment,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  // A private scene/camera just for pass 1. The VERTEX shader ignores the camera,
  // so a bare THREE.Camera (no projection) is fine — it exists only because
  // renderer.render() demands one.
  const gScene = new THREE.Scene();
  gScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gMaterial));
  const gCamera = new THREE.Camera();

  // The G-buffer itself: a tiny offscreen render target, one texel per character
  // cell. Starts at 64x36 and is resized to the real grid on the first setSize().
  // NearestFilter both ways — we sample it at cell centres and never want
  // neighbouring cells bleeding together. No depth/stencil buffer: pure 2D.
  const target = new THREE.WebGLRenderTarget(64, 36, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;

  // --- Pass 2 (composite) uniforms. Note the palette Vector3s are the SAME
  // objects as in gUniforms (not copies) — so a palette change written to one
  // side shows up in both. The scalars (intensity, grain, vignette) are plain
  // numbers though, so apply() below has to write those to both sets by hand.
  const pUniforms = {
    uGBuffer: { value: target.texture },
    uAtlas: { value: atlas },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrid: { value: new THREE.Vector2(64, 36) },
    uTime: { value: 0 },
    uVoid: { value: gUniforms.uVoid.value },
    uTide: { value: gUniforms.uTide.value },
    uVerdant: { value: gUniforms.uVerdant.value },
    uIris: { value: gUniforms.uIris.value },
    uFrost: { value: gUniforms.uFrost.value },
    uIntensity: { value: aurora.intensity },
    uGrain: { value: finish.grain },
    uVignette: { value: finish.vignette },
  };

  // Pass-2 material: the COMPOSITE shader, again on a full-screen quad. This one
  // is the module's public `scene` — main.js renders it to the screen normally.
  const pMaterial = new THREE.ShaderMaterial({
    uniforms: pUniforms,
    vertexShader: VERTEX,
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pMaterial));
  const camera = new THREE.Camera();

  // Live viewport size and a mutable copy of the grid settings (apply() can
  // change cellPx/minCols/maxCols at runtime from the settings panel).
  let viewW = 1;
  let viewH = 1;
  let liveAscii = { ...ascii };

  // Recompute the grid and resize the offscreen target to match. Only calls
  // setSize on the target when the dimensions actually changed — reallocating a
  // render target is not free. Also refreshes uResolution on both passes.
  function resizeGrid() {
    const [cols, rows] = gridFor(viewW, viewH, liveAscii);
    if (target.width !== cols || target.height !== rows) target.setSize(cols, rows);
    pUniforms.uGrid.value.set(cols, rows);
    gUniforms.uResolution.value.set(viewW, viewH);
    pUniforms.uResolution.value.set(viewW, viewH);
  }

  return {
    scene,
    camera,
    // Called by main.js each frame BEFORE it renders `scene` to the screen. This
    // is pass 1: point the renderer at our offscreen target, draw the scene
    // shader into it, then restore whatever render target and autoClear the
    // caller had set. autoClear is forced on so each frame starts from a clean
    // target (stale cells would otherwise ghost).
    prerender(renderer) {
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.render(gScene, gCamera);
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
    },
    // Viewport changed (window resize / monitor change). Stash the size and
    // rebuild the grid.
    setSize(width, height) {
      viewW = Math.max(1, width);
      viewH = Math.max(1, height);
      resizeGrid();
    },
    // Adaptive-quality hook: main.js drops the octave count when the frame
    // budget slips. Only pass 1 has fbm, so only gUniforms needs it.
    setOctaves(count) {
      gUniforms.uOctaves.value = Math.min(Math.max(count | 0, 1), 8);
    },
    // Live config patch from the settings panel / host. Every branch is
    // null-guarded so a partial patch only touches what it names. Palette vec3s
    // are shared objects so setting them once updates both passes; scalars that
    // both passes read (intensity, grain, vignette) are written twice.
    apply(cfg) {
      const p = cfg.palette;
      if (p) {
        if (p.void) gUniforms.uVoid.value.set(...hexToRgb(p.void));
        if (p.tide) gUniforms.uTide.value.set(...hexToRgb(p.tide));
        if (p.verdant) gUniforms.uVerdant.value.set(...hexToRgb(p.verdant));
        if (p.iris) gUniforms.uIris.value.set(...hexToRgb(p.iris));
        if (p.frost) gUniforms.uFrost.value.set(...hexToRgb(p.frost));
      }
      const a = cfg.aurora;
      if (a) {
        if (a.intensity != null) {
          gUniforms.uIntensity.value = a.intensity;
          pUniforms.uIntensity.value = a.intensity;
        }
        if (a.speed != null) gUniforms.uSpeed.value = a.speed;
        if (a.height != null) gUniforms.uHeight.value = a.height;
      }
      const h = cfg.horizon;
      if (h) {
        if (h.y != null) gUniforms.uHorizonY.value = h.y;
        if (h.glow != null) gUniforms.uHorizonGlow.value = h.glow;
        if (h.reflection != null) gUniforms.uReflection.value = h.reflection;
      }
      const s = cfg.stars;
      if (s) {
        if (s.density != null) gUniforms.uStars.value = s.density;
        if (s.twinkle != null) gUniforms.uTwinkle.value = s.twinkle;
      }
      const f = cfg.finish;
      if (f) {
        if (f.grain != null) {
          gUniforms.uGrain.value = f.grain;
          pUniforms.uGrain.value = f.grain;
        }
        if (f.vignette != null) {
          gUniforms.uVignette.value = f.vignette;
          pUniforms.uVignette.value = f.vignette;
        }
      }
      // Grid settings changed -> update liveAscii and rebuild the grid (which
      // may resize the offscreen target).
      const az = cfg.ascii?.[sceneId];
      if (az) {
        if (az.cellPx != null) liveAscii.cellPx = az.cellPx;
        if (az.minCols != null) liveAscii.minCols = az.minCols;
        if (az.maxCols != null) liveAscii.maxCols = az.maxCols;
        resizeGrid();
      }
    },
    // Per-frame tick: feed the elapsed time to both passes (pass 1 animates the
    // scene, pass 2 animates the grain).
    update(elapsed) {
      gUniforms.uTime.value = elapsed;
      pUniforms.uTime.value = elapsed;
    },
    // Scene teardown. Free both materials and the render target; the glyph atlas
    // is deliberately NOT disposed — it's the shared sharedAtlas and the next
    // scene will want it.
    dispose() {
      gMaterial.dispose();
      pMaterial.dispose();
      target.dispose();
    },
  };
}
