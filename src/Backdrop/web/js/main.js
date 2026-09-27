// main.js — the scene's boot sequence and render loop. This is the file index.html
// loads as a module; everything else (scenes, motes, audio, palettes, the host
// bridge) hangs off what boot() wires together here.
//
// Boreal Drift — entry point.
//
// Two passes per frame: the sky quad, then the mote field on top. The frame governor
// keeps the whole thing cheap, because this runs for hours behind everything else
// you are actually doing.

import * as THREE from 'three';
// The ?v=N on every import is cache-busting. WebView2 caches modules hard under the
// shared user-data folder, so bumping the integer is how a changed file actually
// gets picked up on the next launch. Plain browsers don't need it but don't mind it.
import { loadConfig } from './config.js?v=13';
import { createMotes } from './motes.js?v=6';
import { createHud } from './hud.js?v=6';
import { tellHost, onHostMessage, reportError } from './host.js?v=6';
import { createScene, nextSceneId, SCENE_IDS, SCENE_META, visibleSceneIds } from './scenes.js?v=25';
import { findPalette, randomPalette, applyPaletteToConfig } from './palettes.js?v=7';
import { createLowVibe } from './audio.js?v=18';
import { loadCatalog, setInstalled, loadTheme, resolveSceneId, dropTheme, getCatalog, ensureInstalled, getInstalled } from './theme-catalog.js';

// three r150+ tries to manage color spaces for you. Our shaders were authored
// against raw linear values and the output is a background nobody colour-picks,
// so we opt out to skip the per-frame conversion cost and keep the look stable.
THREE.ColorManagement.enabled = false;

// Hard ceiling on the render target: width * height after all scaling must stay
// under this. On a 4K or multi-monitor span the naive pixel count balloons the
// fragment-shader cost (this is a full-screen noise shader), so we clamp it.
const MAX_PIXELS = 1_800_000;

// The adaptive-quality ladder. Each rung is (render scale, noise octaves): lower
// scale = fewer pixels, fewer octaves = cheaper noise. checkBudget() walks DOWN
// this ladder when the machine can't keep up; it never walks back up, because a
// wallpaper flickering between quality levels is more annoying than a soft one.
const QUALITY_LADDER = [
  { scale: 0.85, octaves: 4 },
  { scale: 0.7, octaves: 3 },
  { scale: 0.55, octaves: 3 },
  { scale: 0.45, octaves: 2 },
];

// Kick off boot and make sure a failure is visible somewhere. reportError posts to
// the WPF host (which logs to file); the #fallback element is a static CSS gradient
// in index.html so a dead WebGL context still leaves something on the desktop.
boot().catch((error) => {
  reportError('boot', error);
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.hidden = false;
});

async function boot() {
  // Config first, then the theme catalog (themes/index.json). config.installed is
  // the list of optional themes the user has actually added; setInstalled filters
  // it against what the catalog offers so a stale id can't crash us later.
  const config = await loadConfig();
  await loadCatalog();
  setInstalled(config.installed);

  // Scene selection has two sources: a ?scene= in the URL (how the dev harness and
  // the "next/prev" hotkeys drive it) and config.scene (what WebView2 boots with,
  // since it has no query string). Optional themes only render if they're installed,
  // so ensureInstalled() auto-adds any catalog id that got named here, and
  // resolveSceneId() falls back to 'aurora' for anything still unresolved.
  const queryScene = new URLSearchParams(location.search).get('scene');
  ensureInstalled(queryScene);
  ensureInstalled(config.scene);
  config.installed = getInstalled();
  if (queryScene) config.scene = queryScene;
  config.scene = resolveSceneId(config.scene);

  const canvas = document.getElementById('stage');
  // hosted = running inside the WPF WebView2 (the real wallpaper). embedded = running
  // in an <iframe> (a preview tile in the settings UI). The try/catch is because
  // reading window.top across origins throws — and if it throws, assume embedded.
  const hosted = Boolean(globalThis.chrome?.webview);
  const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // A preview tile is tiny and there might be several on screen at once, so cap the
  // frame rate, halve the resolution, ask the GPU for its low-power part, and kill
  // the motes entirely. None of that detail is visible at thumbnail size anyway.
  if (embedded) {
    config.render.targetFps = Math.min(config.render.targetFps, 18);
    config.render.renderScale = Math.min(config.render.renderScale, 0.5);
    config.render.powerPreference = 'low-power';
    config.motes.count = 0;
  }

  // Only two of the built-in scenes are designed to have the floating-particle
  // layer drawn over them; on the others the motes look wrong (wrong depth, wrong
  // palette) so we gate on scene id. Optional themes never get core motes — if they
  // want particles they ship their own overlay (see syncFlyers / createOverlay).
  function CORE_HAS_MOTES(id) {
    return id === 'aurora' || id === 'ion';
  }
  // motesOn is the final decision: a positive count in config AND a scene that
  // supports them. The `| 0` coerces a possibly-undefined count to an integer.
  const motesOn = (config.motes.count | 0) > 0 && CORE_HAS_MOTES(config.scene);

  let sky;
  // The ambient audio bed. Skipped entirely for preview iframes (you don't want a
  // wall of settings thumbnails all droning at once). ?? 0.2 is the default volume.
  const vibe = embedded ? null : createLowVibe(config.audio?.volume ?? 0.2, config.scene);

  // Per-scene overrides live in config.scenes[id]: aurora intensity/speed/height and
  // audio volume that a user tuned for one specific scene. We fold them onto the
  // live config, then push the result into the sky shader and the audio engine.
  // Called on boot, on every scene switch, and whenever the host sends new tuning.
  function applySceneTune(id) {
    const tune = config.scenes?.[id];
    if (tune) {
      if (!config.aurora) config.aurora = {};
      if (tune.intensity != null) config.aurora.intensity = tune.intensity;
      if (tune.speed != null) config.aurora.speed = tune.speed;
      if (tune.height != null) config.aurora.height = tune.height;
      if (tune.volume != null) {
        config.audio ??= {};
        config.audio.volume = tune.volume;
      }
    }
    sky?.apply(config);
    const vol = config.audio?.volume;
    if (vol != null) vibe?.setVolume?.(vol);
    vibe?.setEnabled?.(config.audio?.enabled !== false);
  }

  applySceneTune(config.scene);

  // The one WebGL renderer for the whole app. The flags all trade quality we don't
  // need for speed: antialias off (a soft noise field has no hard edges to jag),
  // alpha off (the canvas fully covers the page, no compositing with the DOM),
  // stencil/depth off (everything is full-screen quads drawn back-to-front, so
  // there's nothing to depth-test). powerPreference comes from config — 'low-power'
  // for previews, usually 'high-performance' for the real wallpaper.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: config.render.powerPreference,
    stencil: false,
    depth: false,
  });
  // autoClear on = three wipes the buffer before each render() call. That's fine for
  // a single-pass scene, but when we're compositing motes/flyers on top we need to
  // clear once and then draw multiple layers, so we turn it off and clear by hand.
  renderer.autoClear = !motesOn;

  // Load the optional theme module for this scene, if it is one. Core scenes return
  // null here. A catalog theme that fails to produce a fragment shader is reported
  // (the host logs it) and createScene falls back to aurora on its own.
  let themeMod = await loadTheme(config.scene);
  if (!themeMod?.fragment && getCatalog().some((t) => t.id === config.scene)) {
    reportError('theme', new Error(`${config.scene} failed to load; showing aurora`));
  }
  vibe?.setThemeModule?.(themeMod);
  // sky is the main visual: a scene + camera + the full-screen shader. Built from
  // the scene id, the config, and (for themes) the loaded module.
  sky = createScene(config.scene, config, themeMod);
  let flyers = null;

  // flyers = the optional per-theme "geeked" overlay (extra animated sprites a theme
  // can add on top of its own sky). Only built when config turns it on for this
  // scene AND the theme exports createOverlay. Rebuilt on every scene switch.
  async function syncFlyers() {
    flyers?.dispose?.();
    flyers = null;
    const on = Boolean(config.scenes?.[config.scene]?.geeked);
    if (!on || !themeMod?.createOverlay) return;
    try {
      flyers = await themeMod.createOverlay(THREE, config);
    } catch (error) {
      console.warn('geeked overlay failed', error);
    }
  }
  await syncFlyers();

  // The remaining pieces: motes (only if motesOn), the HUD (fps/debug readout),
  // the "rack" (the on-screen scene/palette picker — only in a plain browser, since
  // the hosted wallpaper is driven from the tray and previews have no room for it),
  // and the overlay (the scene-name banner that fades in on a switch).
  const motes = motesOn ? createMotes(config) : null;
  const hud = createHud(config);
  const rack = hosted || embedded ? null : mountRack();
  const overlay = mountOverlay();

  // Pick the ladder rung whose render scale is closest to what config asked for,
  // then apply it (force, because rung is already set and applyRung early-returns
  // on a no-op). This sets the starting quality; checkBudget only ever lowers it.
  let rung = nearestRung(config.render.renderScale);
  applyRung(rung, { force: true });

  // Milliseconds per frame we're aiming for. 1000/30 ≈ 33ms, 1000/18 ≈ 55ms. The
  // frame loop uses this to skip rAF callbacks that come too early.
  const frameBudget = 1000 / config.render.targetFps;

  // elapsed = shader clock (seconds, accumulated from clamped deltas so a background
  // tab that was frozen for a minute doesn't jump the animation). lastTick feeds it.
  let elapsed = 0;
  let lastTick = performance.now();

  // Loop bookkeeping. running = the loop is live; handle = the rAF id so we can
  // cancel it; lastDraw = when we last actually rendered (for the fps throttle);
  // drawn + windowStart = a rolling count of real frames for checkBudget's math.
  let running = true;
  let handle = 0;
  let lastDraw = 0;
  let drawn = 0;
  let windowStart = performance.now();

  // Recompute the render-target size from the window size, the ladder's current
  // scale, and devicePixelRatio — then clamp to MAX_PIXELS. Called on boot, on
  // (debounced) window resize, on every scene switch, and after a quality step.
  function resize() {
    const scale = QUALITY_LADDER[rung].scale;
    // Cap DPR at 1.25 (1.0 for previews). On a 2x display, rendering at full DPR
    // means 4x the pixels for detail a wallpaper doesn't need — the scale factor
    // plus this cap is what keeps the shader affordable.
    const dpr = Math.min(window.devicePixelRatio || 1, embedded ? 1 : 1.25);

    let width = Math.max(1, Math.round(window.innerWidth * dpr * scale));
    let height = Math.max(1, Math.round(window.innerHeight * dpr * scale));

    // Final safety net: if width*height still exceeds MAX_PIXELS (huge monitor,
    // multi-display span), shrink both dimensions by sqrt(1/over) so the total
    // pixel count lands exactly on the ceiling while keeping the aspect ratio.
    const over = (width * height) / MAX_PIXELS;
    if (over > 1) {
      const k = Math.sqrt(1 / over);
      width = Math.max(1, Math.round(width * k));
      height = Math.max(1, Math.round(height * k));
    }

    // setSize(w, h, false): the `false` tells three NOT to write CSS width/height
    // onto the canvas — it's stretched to fill by CSS already, and we're rendering
    // at a lower internal resolution on purpose. The motes get the same buffer size
    // plus the ratio of buffer-width to CSS-width so their point sizes stay right.
    renderer.setSize(width, height, false);
    sky?.setSize(width, height);
    motes?.setSize(width, height, width / Math.max(window.innerWidth, 1));
    sizeOverlay();
  }

  // Move to a ladder rung. Clamps into range, no-ops if we're already there (unless
  // forced), and pushes the rung's octave count into the sky shader. Note it does
  // NOT call resize() — the caller does, because resize reads the new scale.
  function applyRung(index, { force = false } = {}) {
    const next = Math.min(Math.max(index, 0), QUALITY_LADDER.length - 1);
    if (!force && next === rung) return false;
    rung = next;
    sky?.setOctaves(QUALITY_LADDER[rung].octaves);
    return true;
  }

  // Given a target scale from config, find the ladder index closest to it. Linear
  // scan of four entries — a loop isn't worth optimising.
  function nearestRung(scale) {
    let best = 0;
    let bestGap = Infinity;
    QUALITY_LADDER.forEach((step, index) => {
      const gap = Math.abs(step.scale - scale);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    return best;
  }

  // The adaptive-quality governor. Every ~4 seconds it asks: did we draw at least
  // 80% of the frames we should have in that window? `asked` is (elapsed / budget)
  // * 0.8 — the number of frames 80% throughput would have produced. If we fell
  // short and there's a lower rung left, step down one and resize. We only ever go
  // down: on a slow machine this settles to a sustainable level and stays there,
  // instead of oscillating. Disabled entirely if config.render.adaptiveQuality is off.
  function checkBudget(now) {
    if (!config.render.adaptiveQuality) return;
    if (now - windowStart < 4000) return;

    const asked = ((now - windowStart) / frameBudget) * 0.8;
    if (drawn < asked && rung < QUALITY_LADDER.length - 1) {
      applyRung(rung + 1);
      resize();
      console.info(`Backdrop: stepped down to scale ${QUALITY_LADDER[rung].scale}`);
    }

    // Reset the counting window regardless, so the next check measures fresh.
    drawn = 0;
    windowStart = now;
  }

  // Tear down the current scene and build a named one. Driven by the picker, the
  // [ ] hotkeys, and host "next"/"prev" messages. Async because loadTheme() may
  // dynamically import() a theme module. If that throws, we fall back to aurora
  // (the one scene guaranteed to exist and need no module).
  async function switchScene(name) {
    // Auto-install a catalog theme the moment it's asked for, then resolve — an
    // uninstalled/unknown id collapses to aurora here.
    ensureInstalled(name);
    config.installed = getInstalled();
    const next = resolveSceneId(name || config.scene);
    if (!next) return;

    // Dispose the old sky's GPU resources before building the new one — otherwise
    // switching scenes for hours leaks shader programs and textures.
    sky?.dispose?.();
    sky = null;
    config.scene = next;
    applySceneTune(next);
    try {
      themeMod = await loadTheme(next);
      vibe?.setThemeModule?.(themeMod);
      vibe?.setScene?.(next);
      sky = createScene(next, config, themeMod);
      await syncFlyers();
    } catch (error) {
      // Aurora fallback: any failure building a non-aurora scene drops us to aurora
      // with no theme module and no flyers. If aurora itself is what failed, there's
      // nothing safe left to try, so we just leave sky null and let the loop idle.
      reportError(`scene:${next}`, error);
      if (next !== 'aurora') {
        config.scene = 'aurora';
        applySceneTune('aurora');
        themeMod = null;
        vibe?.setThemeModule?.(null);
        vibe?.setScene?.('aurora');
        sky = createScene('aurora', config, null);
        flyers?.dispose?.();
        flyers = null;
      }
    }

    // Re-assert quality (force, because the new sky needs its octave count set),
    // resize to build its render target, then update the picker, the URL, and pop
    // the scene-name banner.
    applyRung(rung, { force: true });
    resize();
    paintRack();
    syncUrl();
    announce();
  }

  // Apply a partial config patch from the host at runtime (the tray/settings UI
  // sends {type:'live', config:{...}}). The job here is to figure out the SMALLEST
  // update: a scene change needs a full switchScene, but a palette or volume tweak
  // can just be pushed into the live objects without rebuilding anything.
  function applyLive(next) {
    // Theme list changed: sync it, and drop the cached module of anything the user
    // uninstalled so re-adding it later re-fetches a fresh copy.
    if (Array.isArray(next.installed)) {
      const prev = new Set(config.installed ?? []);
      setInstalled(next.installed);
      for (const id of prev) {
        if (!next.installed.includes(id)) dropTheme(id);
      }
    }
    // Scene actually changed → full switch, nothing else in this patch matters yet
    // (switchScene re-applies everything from the merged config).
    if (next.scene && next.scene !== config.scene) {
      Object.assign(config, next);
      if (next.palette) config.palette = next.palette;
      void switchScene(next.scene);
      return;
    }
    // The current scene just got uninstalled out from under us (resolveSceneId no
    // longer returns it) → bail to aurora.
    if (Array.isArray(next.installed) && resolveSceneId(config.scene) !== config.scene) {
      Object.assign(config, next);
      void switchScene('aurora');
      return;
    }

    // Same scene: apply changes in place. Snapshot the few things we need to detect
    // a transition (palette name, whether audio was off, whether flyers were on),
    // then merge the patch.
    const palBefore = config.paletteName;
    const audioWasOff = config.audio?.enabled === false;
    const geekedBefore = Boolean(config.scenes?.[config.scene]?.geeked);
    Object.assign(config, next);
    if (next.palette) config.palette = next.palette;

    // Audio: push volume, flip enabled, and start/stop the engine — but only
    // actually start() if it was previously off (audioWasOff), so we don't restart
    // a running bed on every unrelated tweak.
    if (next.audio) {
      const enabled = config.audio?.enabled !== false;
      if (config.audio?.volume != null) vibe?.setVolume?.(config.audio.volume);
      vibe?.setEnabled?.(enabled);
      if (!enabled) vibe?.stop();
      else if (audioWasOff) void vibe?.start();
    }

    // Re-tune, push the whole config into the shader, and toggle flyers only if the
    // geeked flag crossed a boundary (syncFlyers is an async rebuild — not free).
    if (next.scenes) applySceneTune(config.scene);
    sky?.apply(config);
    if (Boolean(config.scenes?.[config.scene]?.geeked) !== geekedBefore) void syncFlyers();

    motes?.apply(config);
    paintRack();
    // Only re-announce (pop the banner) if the palette name genuinely changed.
    if (next.paletteName && next.paletteName !== palBefore) announce();
  }

  // Pick a random palette (different from the current one), fold its colours into
  // config, and push them everywhere: shader, motes, picker, URL. tellHost tells the
  // WPF side so the choice survives a reload / gets written back to settings.
  function shufflePalette() {
    const entry = randomPalette(config.paletteName);
    applyPaletteToConfig(config, entry);
    sky?.apply(config);
    motes?.apply(config);
    paintRack();
    syncUrl();
    tellHost({ type: 'live', config });
    announce();
  }

  // randomizeLook() — the "R" preset randomizer. Deliberately narrow: it rolls
  // ONLY the star field, the glow/atmosphere and the planet-like motes. It never
  // touches the palette (that's Shuffle / Win+P), never changes the scene, and
  // never edits per-scene intensity/speed/height, so the theme you are looking
  // at stays the theme you are looking at — only its sky dressing is re-rolled.
  function randomizeLook() {
    const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
    const round = (v, dp) => Number(v.toFixed(dp));

    // Stars: density and twinkle. Note twinkle doubles as the "life" (motion
    // amount) control on the image themes, so it is kept in a lively band
    // rather than allowed near zero, which would freeze those scenes.
    config.stars = {
      density: round(rnd(0.55, 1.75), 2),
      twinkle: round(rnd(0.45, 1.0), 2),
    };

    // Glow: the horizon bloom and how much sky is mirrored below it.
    config.horizon = {
      ...(config.horizon ?? {}),
      y: round(rnd(0.16, 0.44), 2),
      glow: round(rnd(0.45, 1.9), 2),
      reflection: round(rnd(0.25, 0.85), 2),
    };

    // Planets: the drifting motes read as small worlds/dust. Colour is left
    // alone so this stays palette-neutral.
    config.motes = {
      ...(config.motes ?? {}),
      count: Math.round(rnd(160, 620)),
      size: round(rnd(1.6, 4.2), 1),
      drift: round(rnd(0.18, 0.85), 2),
      opacity: round(rnd(0.30, 0.80), 2),
    };

    sky?.apply(config);
    motes?.apply(config);
    paintRack();
    syncUrl();
    tellHost({ type: 'live', config });
    announce();
  }

  // Human-readable palette name for the banner and picker. 'boreal' is the built-in
  // default and displays as "Boreal"; anything else is looked up in the palette table.
  function paletteLabel() {
    if (!config.paletteName || config.paletteName === 'boreal') return 'Boreal';
    return findPalette(config.paletteName)?.label ?? config.paletteName;
  }

  // Build the scene-name banner. It's a 2D <canvas> we draw text into, wrapped as a
  // THREE.CanvasTexture on a full-screen quad in its own mini-scene. Why route it
  // through WebGL instead of just showing the DOM canvas? So it composites in the
  // same pass as the wallpaper and can't be a separate layer the OS has to blend.
  // LinearFilter + no mipmaps because it's always drawn at 1:1, and the DOM element
  // itself is kept visibility:hidden (see drawOverlay) — only its pixels are used.
  function mountOverlay() {
    const el = document.createElement('canvas');
    el.className = 'overlay';
    el.setAttribute('aria-live', 'polite');
    const ctx = el.getContext('2d', { alpha: true });
    const tex = new THREE.CanvasTexture(el);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    // transparent + no depth so it lays over whatever's already in the buffer;
    // toneMapped:false so the text colours come out exactly as authored.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const layer = new THREE.Scene();
    layer.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    document.body.appendChild(el);
    // until = timestamp the banner should vanish at; scene/blurb/palette = the text.
    return {
      el, ctx, tex, layer, camera: new THREE.Camera(),
      until: 0, scene: '', blurb: '', palette: '',
    };
  }

  // The banner canvas is sized to the full CSS viewport (DPR-scaled, capped at 2) —
  // unlike the render target it isn't downscaled, because crisp text matters and
  // it's cheap 2D fill work, not a shader.
  function sizeOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.el.width = Math.max(1, Math.round(window.innerWidth * dpr));
    overlay.el.height = Math.max(1, Math.round(window.innerHeight * dpr));
    overlay.tex.needsUpdate = true;
  }

  // Arm the banner: fill in the current scene/palette text and set it to fade out
  // 3.8s from now. Also tells the host so it can mirror the label in its own UI.
  function announce() {
    const meta = SCENE_META[config.scene] ?? { label: config.scene, blurb: '' };
    overlay.scene = meta.label;
    overlay.blurb = meta.blurb ?? '';
    overlay.palette = paletteLabel();
    overlay.until = performance.now() + 3800;
    tellHost({ type: 'announce', scene: overlay.scene, palette: overlay.palette });
  }

  // Redraw the banner for this frame. Bails immediately once it has expired (or was
  // never armed) — in the common case this is one clearRect and an early return.
  // The last 800ms are a linear alpha fade. setTransform maps CSS pixels to the
  // DPR-scaled backing store so all the coordinates below can be written in CSS px.
  function paintOverlay(now) {
    const ctx = overlay.ctx;
    const canvas = overlay.el;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const left = overlay.until - now;
    if (left <= 0 || !overlay.scene) return;

    const fade = left > 800 ? 1 : Math.max(0, left / 800);
    const cssW = Math.max(window.innerWidth, 1);
    const cssH = Math.max(window.innerHeight, 1);
    ctx.save();
    ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0);

    // Measure the title and palette text first so the rounded backing card can be
    // sized to fit (clamped to the viewport width), then centred horizontally at
    // 36% down the screen.
    ctx.font = '200 54px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    const titleW = ctx.measureText(overlay.scene).width;
    ctx.font = '500 15px "Segoe UI", sans-serif';
    const palW = ctx.measureText(overlay.palette).width;
    const boxW = Math.min(cssW - 48, Math.max(320, titleW, palW) + 88);
    const boxH = 140;
    const x = (cssW - boxW) / 2;
    const y = cssH * 0.36;

    // The dark rounded card behind the text (arcTo x4 = a rounded rectangle, since
    // the canvas 2D API has no native one). Drawn at 78% of the fade alpha so it's
    // always a touch more transparent than the text on top of it.
    ctx.globalAlpha = fade * 0.78;
    ctx.fillStyle = '#04060c';
    ctx.beginPath();
    const r = 18;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + boxW, y, r);
    ctx.closePath();
    ctx.fill();

    // Three stacked lines, all centred: the scene name (large, thin), an optional
    // one-line blurb (small, dim), and the palette name (small, in the app's green
    // accent). y offsets are hand-tuned against boxH.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#cfe9ff';
    ctx.font = '200 52px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    ctx.fillText(overlay.scene, cssW / 2, y + 58);

    if (overlay.blurb) {
      ctx.globalAlpha = fade * 0.65;
      ctx.fillStyle = '#9db0c8';
      ctx.font = '500 13px "Segoe UI", sans-serif';
      ctx.fillText(overlay.blurb, cssW / 2, y + 86);
    }

    ctx.globalAlpha = fade;
    ctx.fillStyle = '#35e3a0';
    ctx.font = '600 14px "Segoe UI", sans-serif';
    ctx.fillText(overlay.palette, cssW / 2, y + 114);
    ctx.restore();
    overlay.tex.needsUpdate = true;
  }

  // Composite the banner quad into the frame buffer without clearing what's already
  // there (autoClear off, restored after). The DOM canvas is forced hidden every
  // frame — we only ever want its texture, never the element itself on the page.
  function drawOverlay() {
    overlay.el.style.visibility = 'hidden';
    if (overlay.until <= performance.now() || !overlay.scene) return;
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlay.layer, overlay.camera);
    renderer.autoClear = prev;
  }

  // Repaint the on-screen picker ("rack"/dock): rebuild the scene chips, refresh the
  // palette label, and mark the active scene. No-op when there's no rack (hosted or
  // preview). Rebuilt from SCENE_IDS each time because installing a theme grows it.
  function paintRack() {
    if (!rack) return;
    const row = rack.querySelector('.dock__row');
    if (row) {
      const chips = visibleSceneIds().map((id) =>
        `<button type="button" data-scene="${id}">${(SCENE_META[id] ?? { label: id }).label}</button>`).join('');
      row.innerHTML = `${chips}<button type="button" data-act="shuffle">P</button>`
        + `<button type="button" data-act="randomize" title="Randomize stars, glow and planets">R</button>`;
    }
    rack.querySelector('[data-palette]').textContent = paletteLabel();
    for (const btn of rack.querySelectorAll('[data-scene]')) {
      btn.classList.toggle('is-on', btn.dataset.scene === config.scene);
    }
  }

  // Mirror the current scene/palette into the URL query string so a reload (or a
  // copied link) comes back to the same view. Skipped when hosted — WebView2 has no
  // address bar and its state is persisted by the WPF side instead. replaceState,
  // not pushState, so this doesn't pile up browser history entries.
  function syncUrl() {
    if (hosted) return;
    const url = new URL(location.href);
    url.searchParams.set('scene', config.scene);
    if (config.paletteName && config.paletteName !== 'boreal') {
      url.searchParams.set('palette', config.paletteName);
    } else {
      url.searchParams.delete('palette');
    }
    if (url.href !== location.href) history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  // Build the picker once and attach it to the body. One delegated click handler on
  // the root reads data-act / data-scene off whatever button was hit — simpler than
  // wiring a listener per chip, and it survives paintRack() replacing the innerHTML.
  function mountRack() {
    const root = document.createElement('div');
    root.className = 'dock';
    const chips = visibleSceneIds().map((id) =>
      `<button type="button" data-scene="${id}">${(SCENE_META[id] ?? { label: id }).label}</button>`).join('');
    root.innerHTML = `
      <div class="dock__row">${chips}<button type="button" data-act="shuffle">P</button><button type="button" data-act="randomize" title="Randomize stars, glow and planets">R</button></div>
      <p class="dock__meta"><span data-palette></span> · Win+[ ] · Win+P · Win+R</p>
    `;
    root.addEventListener('click', (event) => {
      const t = event.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.act === 'shuffle') shufflePalette();
      if (t.dataset.act === 'randomize') randomizeLook();
      else if (t.dataset.scene) switchScene(t.dataset.scene);
    });
    document.body.appendChild(root);
    return root;
  }

  // The render loop. We re-request rAF unconditionally (so the loop never dies), but
  // the second line is the throttle: rAF fires at the display's refresh rate, and if
  // we haven't yet reached our frameBudget we just return without drawing. That's how
  // a 33ms target coexists with a 144Hz monitor without burning the GPU.
  //
  // dt is clamped to 0.1s so a hitch (or a tab that was backgrounded) can't teleport
  // the animation; elapsed is the monotonic shader clock built from those deltas.
  function frame(now) {
    handle = requestAnimationFrame(frame);
    if (now - lastDraw < frameBudget - 1) return;
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    elapsed += dt;
    lastTick = now;
    lastDraw = now;

    hud.update();
    if (sky) {
      // Advance every animated system for this frame.
      sky.update(elapsed);
      motes?.update(elapsed);
      flyers?.update?.(elapsed, dt);
      // prerender is for scenes that render to an off-screen target first (e.g. the
      // ASCII / G-buffer pass) before their final quad is drawn.
      sky.prerender?.(renderer);

      // If there are extra layers (motes and/or flyers) we can't let three auto-
      // clear before each render() — we'd wipe the sky. So: clear once by hand, then
      // stack sky -> motes -> flyers into the same buffer. Otherwise it's a single
      // render() and autoClear (still true from setup) handles the clear.
      const drawMotes = motes && CORE_HAS_MOTES(config.scene);
      if (drawMotes || flyers) {
        const prevClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clear();
        renderer.render(sky.scene, sky.camera);
        if (drawMotes) renderer.render(motes.scene, motes.camera);
        if (flyers) renderer.render(flyers.scene, flyers.camera);
        renderer.autoClear = prevClear;
      } else {
        renderer.render(sky.scene, sky.camera);
      }
    }

    // Banner on top, then bump the real-frame counter and let the governor look.
    paintOverlay(now);
    drawOverlay();
    drawn++;
    checkBudget(now);
  }

  // Audio is opt-out: anything other than an explicit enabled:false counts as on.
  function audioAllowed() {
    return config.audio?.enabled !== false;
  }

  // Resume the loop. Resets all the timing state so the first frame after a pause
  // doesn't see a huge dt or a stale budget window, then kicks rAF. Audio can only
  // actually begin after a user gesture (browser autoplay policy) — the input
  // listeners below also call vibe.start() for exactly that reason.
  function start() {
    if (running) return;
    running = true;
    lastTick = performance.now();
    lastDraw = 0;
    drawn = 0;
    windowStart = performance.now();
    handle = requestAnimationFrame(frame);
    if (audioAllowed()) void vibe?.start();
  }

  // Suspend everything: cancel the pending rAF and pause the audio. Called when the
  // tab is hidden or the host reports the wallpaper is occluded (a fullscreen app on
  // top), so we cost essentially nothing while nobody can see us.
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(handle);
    vibe?.stop();
  }

  // Debounce resize: dragging a window edge fires dozens of resize events per
  // second, and rebuilding the render target on each is wasteful — wait 120ms of
  // quiet, then do it once.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // Page Visibility API: stop when hidden, start when shown. This is the main power
  // saver in a plain browser (background tab) and a backup for the host's own
  // occlusion messages when running as the wallpaper.
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  // Keyboard shortcuts, but only when focus isn't in a form control (so typing in
  // the picker's inputs doesn't switch scenes). Any keypress also counts as the
  // user gesture that unlocks audio. [ / ] cycle scenes, p/P shuffles the palette.
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (audioAllowed()) void vibe?.start();
    if (event.key === '[') switchScene(nextSceneId(config.scene, -1));
    if (event.key === ']') switchScene(nextSceneId(config.scene, 1));
    if (event.key === 'p' || event.key === 'P') shufflePalette();
    if (event.key === 'r' || event.key === 'R') randomizeLook();
  });
  // Same audio-unlock trick on any pointer press. Not {once:true} because the audio
  // context can get re-suspended (tab switch, device change) and need re-arming.
  window.addEventListener('pointerdown', () => { if (audioAllowed()) void vibe?.start(); }, { once: false });

  // Messages from the WPF host (tray menu, settings window, global hotkeys that WPF
  // catches because the wallpaper layer can't). visibility = occlusion pause/resume;
  // live = a config patch; shuffle/next/prev mirror the keyboard shortcuts.
  onHostMessage((message) => {
    if (message.type === 'visibility') {
      message.paused ? stop() : start();
    } else if (message.type === 'live' && message.config) {
      applyLive(message.config);
      if (!running) start();
    } else if (message.type === 'shuffle') {
      shufflePalette();
    } else if (message.type === 'randomize') {
      randomizeLook();
    } else if (message.type === 'next') {
      switchScene(nextSceneId(config.scene, 1));
    } else if (message.type === 'prev') {
      switchScene(nextSceneId(config.scene, -1));
    }
  });

  // WebGL context loss (GPU driver reset, TDR, laptop GPU switch). preventDefault
  // lets the browser restore it; until it does we stop and log. On restore we
  // rebuild the render target and resume — three re-uploads the scene resources.
  renderer.getContext().canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stop();
    reportError('webgl', new Error('context lost'));
  });

  renderer.getContext().canvas.addEventListener('webglcontextrestored', () => {
    resize();
    start();
  });

  // Boot tail: size the buffer, paint the picker, write the URL, then start. running
  // is forced false first so start()'s guard doesn't skip the initial kick. announce
  // pops the opening banner; the 'ready' message tells the host it can unhide the
  // WebView2 / stop showing its own placeholder.
  resize();
  paintRack();
  syncUrl();
  running = false;
  start();
  announce();

  tellHost({ type: 'ready' });
}
