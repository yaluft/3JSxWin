// Boreal Drift — entry point.
//
// Two passes per frame: the sky quad, then the mote field on top. The frame governor
// keeps the whole thing cheap, because this runs for hours behind everything else
// you are actually doing.

import * as THREE from 'three';
import { loadConfig } from './config.js?v=12';
import { createMotes } from './motes.js?v=6';
import { createHud } from './hud.js?v=6';
import { tellHost, onHostMessage, reportError } from './host.js?v=6';
import { createScene, nextSceneId, SCENE_IDS, SCENE_META } from './scenes.js?v=20';
import { findPalette, randomPalette, applyPaletteToConfig } from './palettes.js?v=7';
import { createLowVibe } from './audio.js?v=11';
import { loadCatalog, setInstalled, loadTheme, resolveSceneId, dropTheme } from './theme-catalog.js';

THREE.ColorManagement.enabled = false;

const MAX_PIXELS = 1_800_000;

const QUALITY_LADDER = [
  { scale: 0.85, octaves: 4 },
  { scale: 0.7, octaves: 3 },
  { scale: 0.55, octaves: 3 },
  { scale: 0.45, octaves: 2 },
];

boot().catch((error) => {
  reportError('boot', error);
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.hidden = false;
});

async function boot() {
  const config = await loadConfig();
  await loadCatalog();
  setInstalled(config.installed);
  config.scene = resolveSceneId(config.scene);
  const canvas = document.getElementById('stage');
  const hosted = Boolean(globalThis.chrome?.webview);
  const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

  if (embedded) {
    config.render.targetFps = Math.min(config.render.targetFps, 18);
    config.render.renderScale = Math.min(config.render.renderScale, 0.5);
    config.render.powerPreference = 'low-power';
    config.motes.count = 0;
  }

  function CORE_HAS_MOTES(id) {
    return id === 'aurora' || id === 'starwell' || id === 'ion' || id === 'ember';
  }
  const motesOn = (config.motes.count | 0) > 0 && CORE_HAS_MOTES(config.scene);

  let sky;
  const vibe = embedded ? null : createLowVibe(config.audio?.volume ?? 0.2, config.scene);

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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: config.render.powerPreference,
    stencil: false,
    depth: false,
  });
  renderer.autoClear = !motesOn;

  let themeMod = await loadTheme(config.scene);
  vibe?.setThemeModule?.(themeMod);
  sky = createScene(config.scene, config, themeMod);
  let flyers = null;

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
  const motes = motesOn ? createMotes(config) : null;
  const hud = createHud(config);
  const rack = hosted || embedded ? null : mountRack();
  const overlay = mountOverlay();

  let rung = nearestRung(config.render.renderScale);
  applyRung(rung, { force: true });

  const frameBudget = 1000 / config.render.targetFps;

  let elapsed = 0;
  let lastTick = performance.now();

  let running = true;
  let handle = 0;
  let lastDraw = 0;
  let drawn = 0;
  let windowStart = performance.now();

  function resize() {
    const scale = QUALITY_LADDER[rung].scale;
    const dpr = Math.min(window.devicePixelRatio || 1, embedded ? 1 : 1.25);

    let width = Math.max(1, Math.round(window.innerWidth * dpr * scale));
    let height = Math.max(1, Math.round(window.innerHeight * dpr * scale));

    const over = (width * height) / MAX_PIXELS;
    if (over > 1) {
      const k = Math.sqrt(1 / over);
      width = Math.max(1, Math.round(width * k));
      height = Math.max(1, Math.round(height * k));
    }

    renderer.setSize(width, height, false);
    sky?.setSize(width, height);
    motes?.setSize(width, height, width / Math.max(window.innerWidth, 1));
    sizeOverlay();
  }

  function applyRung(index, { force = false } = {}) {
    const next = Math.min(Math.max(index, 0), QUALITY_LADDER.length - 1);
    if (!force && next === rung) return false;
    rung = next;
    sky?.setOctaves(QUALITY_LADDER[rung].octaves);
    return true;
  }

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

  function checkBudget(now) {
    if (!config.render.adaptiveQuality) return;
    if (now - windowStart < 4000) return;

    const asked = ((now - windowStart) / frameBudget) * 0.8;
    if (drawn < asked && rung < QUALITY_LADDER.length - 1) {
      applyRung(rung + 1);
      resize();
      console.info(`Backdrop: stepped down to scale ${QUALITY_LADDER[rung].scale}`);
    }

    drawn = 0;
    windowStart = now;
  }

  async function switchScene(name) {
    const next = resolveSceneId(name || config.scene);
    if (!next) return;
    sky?.dispose?.();
    sky = null;
    config.scene = next;
    applySceneTune(next);
    themeMod = await loadTheme(next);
    vibe?.setThemeModule?.(themeMod);
    vibe?.setScene?.(next);
    sky = createScene(next, config, themeMod);
    await syncFlyers();
    applyRung(rung, { force: true });
    resize();
    paintRack();
    syncUrl();
    announce();
  }

  function applyLive(next) {
    if (Array.isArray(next.installed)) {
      const prev = new Set(config.installed ?? []);
      setInstalled(next.installed);
      for (const id of prev) {
        if (!next.installed.includes(id)) dropTheme(id);
      }
    }
    if (next.scene && next.scene !== config.scene) {
      Object.assign(config, next);
      if (next.palette) config.palette = next.palette;
      void switchScene(next.scene);
      return;
    }
    if (Array.isArray(next.installed) && resolveSceneId(config.scene) !== config.scene) {
      Object.assign(config, next);
      void switchScene('aurora');
      return;
    }
    const palBefore = config.paletteName;
    const audioWasOff = config.audio?.enabled === false;
    const geekedBefore = Boolean(config.scenes?.[config.scene]?.geeked);
    Object.assign(config, next);
    if (next.palette) config.palette = next.palette;

    if (next.audio) {
      const enabled = config.audio?.enabled !== false;
      if (config.audio?.volume != null) vibe?.setVolume?.(config.audio.volume);
      vibe?.setEnabled?.(enabled);
      if (!enabled) vibe?.stop();
      else if (audioWasOff) void vibe?.start();
    }

    if (next.scenes) applySceneTune(config.scene);
    sky?.apply(config);
    if (Boolean(config.scenes?.[config.scene]?.geeked) !== geekedBefore) void syncFlyers();

    motes?.apply(config);
    paintRack();
    if (next.paletteName && next.paletteName !== palBefore) announce();
  }

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

  function paletteLabel() {
    if (!config.paletteName || config.paletteName === 'boreal') return 'Boreal';
    return findPalette(config.paletteName)?.label ?? config.paletteName;
  }

  function mountOverlay() {
    const el = document.createElement('canvas');
    el.className = 'overlay';
    el.setAttribute('aria-live', 'polite');
    const ctx = el.getContext('2d', { alpha: true });
    const tex = new THREE.CanvasTexture(el);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
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
    return {
      el, ctx, tex, layer, camera: new THREE.Camera(),
      until: 0, scene: '', blurb: '', palette: '',
    };
  }

  function sizeOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.el.width = Math.max(1, Math.round(window.innerWidth * dpr));
    overlay.el.height = Math.max(1, Math.round(window.innerHeight * dpr));
    overlay.tex.needsUpdate = true;
  }

  function announce() {
    const meta = SCENE_META[config.scene] ?? { label: config.scene, blurb: '' };
    overlay.scene = meta.label;
    overlay.blurb = meta.blurb ?? '';
    overlay.palette = paletteLabel();
    overlay.until = performance.now() + 3800;
    tellHost({ type: 'announce', scene: overlay.scene, palette: overlay.palette });
  }

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

    ctx.font = '200 54px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    const titleW = ctx.measureText(overlay.scene).width;
    ctx.font = '500 15px "Segoe UI", sans-serif';
    const palW = ctx.measureText(overlay.palette).width;
    const boxW = Math.min(cssW - 48, Math.max(320, titleW, palW) + 88);
    const boxH = 140;
    const x = (cssW - boxW) / 2;
    const y = cssH * 0.36;

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

  function drawOverlay() {
    overlay.el.style.visibility = 'hidden';
    if (overlay.until <= performance.now() || !overlay.scene) return;
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlay.layer, overlay.camera);
    renderer.autoClear = prev;
  }

  function paintRack() {
    if (!rack) return;
    const row = rack.querySelector('.dock__row');
    if (row) {
      const chips = SCENE_IDS.map((id) =>
        `<button type="button" data-scene="${id}">${(SCENE_META[id] ?? { label: id }).label}</button>`).join('');
      row.innerHTML = `${chips}<button type="button" data-act="shuffle">P</button>`;
    }
    rack.querySelector('[data-palette]').textContent = paletteLabel();
    for (const btn of rack.querySelectorAll('[data-scene]')) {
      btn.classList.toggle('is-on', btn.dataset.scene === config.scene);
    }
  }

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

  function mountRack() {
    const root = document.createElement('div');
    root.className = 'dock';
    const chips = SCENE_IDS.map((id) =>
      `<button type="button" data-scene="${id}">${SCENE_META[id].label}</button>`).join('');
    root.innerHTML = `
      <div class="dock__row">${chips}<button type="button" data-act="shuffle">P</button></div>
      <p class="dock__meta"><span data-palette></span> · Win+[ ] · Win+P</p>
    `;
    root.addEventListener('click', (event) => {
      const t = event.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.act === 'shuffle') shufflePalette();
      else if (t.dataset.scene) switchScene(t.dataset.scene);
    });
    document.body.appendChild(root);
    return root;
  }

  function frame(now) {
    handle = requestAnimationFrame(frame);
    if (now - lastDraw < frameBudget - 1) return;
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    elapsed += dt;
    lastTick = now;
    lastDraw = now;

    hud.update();
    if (sky) {
      sky.update(elapsed);
      motes?.update(elapsed);
      flyers?.update?.(elapsed, dt);
      sky.prerender?.(renderer);
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

    paintOverlay(now);
    drawOverlay();
    drawn++;
    checkBudget(now);
  }

  function audioAllowed() {
    return config.audio?.enabled !== false;
  }

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

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(handle);
    vibe?.stop();
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (audioAllowed()) void vibe?.start();
    if (event.key === '[') switchScene(nextSceneId(config.scene, -1));
    if (event.key === ']') switchScene(nextSceneId(config.scene, 1));
    if (event.key === 'p' || event.key === 'P') shufflePalette();
  });
  window.addEventListener('pointerdown', () => { if (audioAllowed()) void vibe?.start(); }, { once: false });

  onHostMessage((message) => {
    if (message.type === 'visibility') {
      message.paused ? stop() : start();
    } else if (message.type === 'live' && message.config) {
      applyLive(message.config);
      if (!running) start();
    } else if (message.type === 'shuffle') {
      shufflePalette();
    } else if (message.type === 'next') {
      switchScene(nextSceneId(config.scene, 1));
    } else if (message.type === 'prev') {
      switchScene(nextSceneId(config.scene, -1));
    }
  });

  renderer.getContext().canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stop();
    reportError('webgl', new Error('context lost'));
  });

  renderer.getContext().canvas.addEventListener('webglcontextrestored', () => {
    resize();
    start();
  });

  resize();
  paintRack();
  syncUrl();
  running = false;
  start();
  announce();

  tellHost({ type: 'ready' });
}
