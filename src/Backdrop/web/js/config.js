// config.js — the single source of truth for every tunable in the scene.
// The page boots by calling loadConfig(): it starts from FALLBACK (below),
// deep-merges whatever config.json holds on top, then lets a few URL query
// params from the host (--fps, --scale, --scene, ...) have the last word.
// Also exports hexToRgb, the one colour conversion every shader module shares.

// palettes.js turns a palette NAME ('nord', 'gruvbox', ...) into the five hex
// slots the scene uses. The ?v=6 is our cache-buster — see the note on the
// fetch() call below for why every local import carries one.
import { findPalette, applyPaletteToConfig } from './palettes.js?v=6';

// FALLBACK is the config the page runs on when config.json is missing,
// truncated, or unreadable (a half-written file during an edit, a 404 on a
// stripped-down deploy). It is a COMPLETE config, not a sparse patch: merge()
// only ever fills gaps from here, so anything absent from FALLBACK can end up
// undefined at runtime and crash a shader that reads it.
//
// TWO-COPIES RULE. This exact object must mirror the shape of config.json.
// config.json is what the user (or the settings panel) edits; FALLBACK is the
// safety net. If you add a key to one, add it to the other with a sane default,
// or the feature silently vanishes whenever config.json fails to load.
//
// And there are literally two copies of this whole web/ folder on disk:
//   src/Backdrop/web/  — the source you edit (this file)
//   dist/web/ , site/public/scene/  — build/publish mirrors that ship
// A change here is not live until it is copied out to those. Keep them in sync.
const FALLBACK = {
  // Which scene module runs, and which named palette colours it. 'boreal' is
  // resolved later by palettes.js; an unknown name just leaves config.palette
  // as-is.
  scene: 'aurora',
  paletteName: 'boreal',
  // Renderer budget. These are deliberately conservative here — a wallpaper
  // should be invisible on the CPU/GPU meter. 'low-power' asks the browser for
  // the integrated GPU on laptops; antialias off because the grain/vignette
  // finish hides edges anyway and MSAA on a full-screen quad is wasted work.
  render: { targetFps: 24, renderScale: 0.65, octaves: 3, adaptiveQuality: true, powerPreference: 'low-power', antialias: false },
  // The five colour slots the shaders read (void = deepest background,
  // frost = brightest highlight). 'palette' is the live set; 'customPalette' is
  // the user's hand-picked set, used only when paletteName === 'custom'.
  palette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' },
  customPalette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' },
  // Per-effect knobs for the default aurora scene. speed here is the FALLBACK
  // value; config.json and the scenes{} table below both override it.
  aurora: { intensity: 0.95, speed: 0.055, height: 0.5 },
  // Horizon line: y is its screen height (0 = bottom, 1 = top), glow is the
  // bloom above it, reflection is how much sky is mirrored below it.
  horizon: { y: 0.36, glow: 0.85, reflection: 0.32 },
  // Starfield density and how hard stars twinkle. twinkle is forced to 0 under
  // prefers-reduced-motion near the end of loadConfig().
  stars: { density: 0.8, twinkle: 0.55 },
  // Floating dust particles (motes.js). 'color' is kept in sync with the
  // palette's frost slot whenever a palette is applied — see loadConfig and
  // applyPaletteToConfig.
  motes: { count: 700, color: "#cfe9ff", size: 2.8, drift: 0.35, opacity: 0.62 },
  // Post-processing pass: film grain amount and vignette darkness at the edges.
  finish: { grain: 0.028, vignette: 0.5 },
  // ASCII scenes render the G-buffer as a grid of glyphs. cellPx is the glyph
  // cell size in pixels; minCols/maxCols clamp how many columns we draw so the
  // grid stays legible on both a laptop panel and a 4K span.
  ascii: {
    terrascii: { cellPx: 6, minCols: 80, maxCols: 480 },
    warpscii: { cellPx: 6, minCols: 80, maxCols: 480 },
    blobscii: { cellPx: 6, minCols: 80, maxCols: 480 },
    glyphfall: { cellPx: 8, minCols: 64, maxCols: 360 },
  },
  // Optional on-screen clock (hud.js). Off by default so the wallpaper stays
  // clean; the settings panel flips 'enabled'.
  hud: { enabled: false, corner: 'bottom-right', clock24h: true, locale: 'en-CA' },
  // Comms panel (the Win+C chat overlay). The C# host actually makes the HTTP
  // call — the page just hands it these endpoint bits. Note the FALLBACK model
  // here ('cheap') is a placeholder: config.json carries the real model id, and
  // config.json also adds an 'imageModel' key that FALLBACK omits. That
  // asymmetry is a mild violation of the mirror rule — harmless only because
  // comms.js treats a missing imageModel as "no image support".
  comms: { enabled: true, url: 'https://ai.yakupov.xyz/api/chat/completions', baseUrl: 'https://ai.yakupov.xyz/api', model: 'cheap', apiKey: '', path: 'chat/completions' },
  // Ambient audio bed. volume is a 0..1 multiplier on top of the per-scene
  // volume in the scenes{} table.
  audio: { enabled: true, volume: 0.2 },
  // Scene folders the user has installed from the catalog. Empty in FALLBACK;
  // config.json lists the real ones. main.js uses this to build the scene menu.
  installed: [],
  // Per-scene overrides, keyed by scene id. When a scene loads, its entry here
  // is merged over the top-level knobs (aurora{}, etc.), so one config.json can
  // carry sensible defaults for every scene at once. 'volume' is that scene's
  // slice of the audio bed.
  scenes: {
    aurora: { intensity: 1.6, speed: 0.16, height: 0.95, volume: 0.18 },
    terrascii: { intensity: 1.1, speed: 0.12, height: 0.7, volume: 0.08 },
    warpscii: { intensity: 1.3, speed: 0.22, height: 0.85, volume: 0.1 },
    ion: { intensity: 1.2, speed: 0.1, height: 0.8, volume: 0.14 },
    blobscii: { intensity: 1.15, speed: 0.16, height: 0.75, volume: 0.08 },
    glyphfall: { intensity: 1.2, speed: 0.18, height: 0.85, volume: 0.1 },
  },
};

// Recursive deep-merge: every value in `patch` wins over `base`, but nested
// objects are merged key-by-key rather than replaced wholesale. That is what
// lets config.json say just { "aurora": { "speed": 0.16 } } and keep the
// intensity/height defaults from FALLBACK.
//   - keys starting with '$' are skipped so config.json can carry '$comment'
//     / '$schema' style annotations without them leaking into the runtime config.
//   - arrays are treated as leaf values (replaced, not merged element-wise) —
//     we want an explicit `installed` list to override, not append.
//   - `base[key] ?? {}` means a nested object in the patch that has no
//     counterpart in FALLBACK still merges cleanly onto an empty object.
function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key.startsWith('$')) continue;
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base[key] ?? {}, value) : value;
  }
  return out;
}

// The one export the page calls at boot. Returns a fully-resolved config:
// FALLBACK  ->  config.json  ->  URL query overrides  ->  palette resolution
// ->  reduced-motion softening. Everything downstream (main.js, every scene)
// just reads the object this returns.
export async function loadConfig() {
  // Start on the safety net. If nothing below succeeds we still return a
  // complete, runnable config.
  let config = FALLBACK;

  try {
    // cache: 'no-cache' forces a revalidation with the server every boot. The
    // JS modules are versioned with ?v=N so the browser can cache them hard,
    // but config.json has no version in its URL — the settings panel rewrites
    // it in place, and we must see that edit on the next launch, not a stale
    // copy from disk cache.
    const response = await fetch('./config.json', { cache: 'no-cache' });
    if (response.ok) config = merge(FALLBACK, await response.json());
  } catch (error) {
    // A missing or malformed config.json is not fatal — log and run on FALLBACK.
    console.warn('config.json unreadable, using defaults', error);
  }

  // CLI overrides arrive as a query string on the page URL, built by the C#
  // host (CommandLineOptions.ToQueryString). These are the only things allowed
  // to beat config.json, because the user typed them for this one launch.
  const query = new URLSearchParams(location.search);

  // --fps <n>: clamp to 144 so a typo can't uncap the render loop.
  const fps = Number(query.get('fps'));
  if (Number.isFinite(fps) && fps > 0) config.render.targetFps = Math.min(fps, 144);

  // --scale <f>: render at a fraction of native resolution then upscale.
  // Clamp to 0.4..1.0 — below 0.4 the scene turns to mud, above 1.0 is
  // pointless supersampling.
  const scale = Number(query.get('scale'));
  if (Number.isFinite(scale) && scale > 0) config.render.renderScale = Math.min(Math.max(scale, 0.4), 1);

  // mode=window means we're in a normal resizable window, not painted on the
  // desktop. Scenes use this to e.g. show a title bar affordance.
  config.windowed = query.get('mode') === 'window';

  // scene=<id> picks the scene for this launch (from --scene / --theme).
  const scene = query.get('scene');
  if (scene) config.scene = scene;

  // geeked=1 is a hidden "show me everything" flag — cranks the current
  // scene's debug/maximal mode. We create the nested entry lazily with ??= so
  // it works even for a scene that has no scenes{} entry yet.
  const geeked = query.get('geeked');
  if (geeked === '1' || geeked === 'true') {
    (config.scenes ??= {})[config.scene] ??= {};
    config.scenes[config.scene].geeked = true;
  }

  // palette=<id> overrides the colour scheme for this launch.
  const paletteName = query.get('palette');
  if (paletteName) config.paletteName = paletteName;

  // Resolve the palette NAME into the five live hex slots.
  //   - 'custom': layer the user's customPalette over whatever's in palette.
  //   - anything else: look it up in palettes.js and let it fill the slots.
  // Either way we also push the 'frost' colour into motes.color so the dust
  // matches the highlight tone.
  if (config.paletteName === 'custom' && config.customPalette) {
    config.palette = { ...config.palette, ...config.customPalette };
    if (config.motes) config.motes.color = config.customPalette.frost;
  } else {
    const named = findPalette(config.paletteName);
    if (named) applyPaletteToConfig(config, named);
  }

  // Someone who turns motion down does not want a churning sky in their peripheral vision.
  // Respect the OS "reduce motion" setting: slow the aurora, kill the twinkle,
  // damp the drift. We soften rather than freeze so it still reads as alive.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    config.aurora.speed *= 0.25;
    config.stars.twinkle = 0;
    config.motes.drift *= 0.3;
  }

  return config;
}

/**
 * '#35e3a0' -> [0.208, 0.890, 0.627]. Kept explicit so nothing gamma-shifts behind our back.
 *
 * Shared by every shader module (sky.js, motes.js, scenes.js, ascii.js) so
 * there is exactly one place that decides how a CSS hex becomes a GLSL vec3.
 * We hand three.js/WebGL raw linear 0..1 channel values and let THAT be the
 * colour — no THREE.Color, whose sRGB-vs-linear handling changes between
 * three.js versions and would quietly shift our palette on upgrade.
 *
 * The parsing is defensive: strip a leading '#', pad short/garbage input out
 * to 6 hex digits with '0', take the first 6, parse as one 24-bit int, then
 * shift out the R/G/B bytes and normalise each to 0..1.
 */
export function hexToRgb(hex) {
  const value = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
