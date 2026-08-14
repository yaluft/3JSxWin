// Boreal Drift — entry point.
//
// Two passes per frame: the sky quad, then the mote field on top. The frame governor
// keeps the whole thing cheap, because this runs for hours behind everything else
// you are actually doing.

import * as THREE from 'three';
import { loadConfig } from './config.js?v=8';
import { createMotes } from './motes.js?v=6';
import { createHud } from './hud.js?v=6';
import { tellHost, onHostMessage, reportError } from './host.js?v=6';
import { createScene, nextSceneId, SCENE_IDS, SCENE_META } from './scenes.js?v=14';
import { findPalette, randomPalette, applyPaletteToConfig } from './palettes.js?v=6';
import { createLowVibe } from './audio.js?v=8';
import { createPulse } from './pulse.js?v=1';

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
  const canvas = document.getElementById('stage');
  const hosted = Boolean(globalThis.chrome?.webview);
  const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

  if (embedded) {
    config.render.targetFps = Math.min(config.render.targetFps, 18);
    config.render.renderScale = Math.min(config.render.renderScale, 0.5);
    config.render.powerPreference = 'low-power';
    config.motes.count = 0;
  }

  const silentScenes = new Set([
    'hexascii', 'terrascii', 'warpscii', 'blobscii', 'wave', 'pulse',
    'petrichor', 'kelp', 'murmur', 'cicada', 'rime',
  ]);
  const motesOn = (config.motes.count | 0) > 0 && !silentScenes.has(config.scene);
  const vibe = embedded ? null : createLowVibe(config.audio?.volume ?? 0.2, config.scene);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: config.render.powerPreference,
    stencil: false,
    depth: false,
  });
  renderer.autoClear = !motesOn;

  let sky = createScene(config.scene, config);
  const motes = motesOn ? createMotes(config) : null;
  const hud = createHud(config);
  const pulse = createPulse(config);
  const rack = hosted || embedded ? null : mountRack();
  const toast = mountToast();
  syncPulse();

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
    pulse.setSize();
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

  function switchScene(name) {
    const next = name || config.scene;
    if (!next) return;
    sky?.dispose?.();
    config.scene = next;
    vibe?.setScene?.(next);
    sky = createScene(next, config);
    syncPulse();
    applyRung(rung, { force: true });
    resize();
    paintRack();
    syncUrl();
    announce();
  }

  function applyLive(next) {
    if (next.scene && next.scene !== config.scene) {
      Object.assign(config, next);
      switchScene(next.scene);
      return;
    }
    const palBefore = config.paletteName;
    Object.assign(config, next);
    if (next.palette) config.palette = next.palette;
    sky?.apply(config);
    motes?.apply(config);
    pulse.apply(config);
    paintRack();
    if (next.paletteName && next.paletteName !== palBefore) announce();
  }

  function shufflePalette() {
    const entry = randomPalette(config.paletteName);
    applyPaletteToConfig(config, entry);
    sky?.apply(config);
    motes?.apply(config);
    pulse.apply(config);
    paintRack();
    syncUrl();
    tellHost({ type: 'live', config });
    announce();
  }

  function paletteLabel() {
    if (!config.paletteName || config.paletteName === 'boreal') return 'Boreal';
    return findPalette(config.paletteName)?.label ?? config.paletteName;
  }

  function mountToast() {
    const root = document.createElement('div');
    root.className = 'toast';
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
      <p class="toast__scene" data-toast-scene></p>
      <p class="toast__blurb" data-toast-blurb></p>
      <p class="toast__palette" data-toast-palette></p>
    `;
    document.body.appendChild(root);
    return root;
  }

  let toastTimer = 0;
  function announce() {
    const meta = SCENE_META[config.scene] ?? { label: config.scene, blurb: '' };
    toast.querySelector('[data-toast-scene]').textContent = meta.label;
    toast.querySelector('[data-toast-blurb]').textContent = meta.blurb ?? '';
    toast.querySelector('[data-toast-palette]').textContent = paletteLabel();
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2400);
  }

  function paintRack() {
    if (!rack) return;
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

  function syncPulse() {
    if (config.scene === 'pulse') {
      canvas.style.visibility = 'hidden';
      pulse.show();
    } else {
      canvas.style.visibility = '';
      pulse.hide();
    }
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
    elapsed += Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    lastDraw = now;

    hud.update();
    if (config.scene === 'pulse') {
      pulse.update(elapsed);
    } else if (sky) {
      sky.update(elapsed);
      motes?.update(elapsed);
      sky.prerender?.(renderer);
      const drawMotes = motes && !silentScenes.has(config.scene);
      if (drawMotes) {
        renderer.clear();
        renderer.render(sky.scene, sky.camera);
        renderer.render(motes.scene, motes.camera);
      } else {
        renderer.render(sky.scene, sky.camera);
      }
    }

    drawn++;
    checkBudget(now);
  }

  function start() {
    if (running) return;
    running = true;
    lastTick = performance.now();
    lastDraw = 0;
    drawn = 0;
    windowStart = performance.now();
    handle = requestAnimationFrame(frame);
    void vibe?.start();
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
    void vibe?.start();
    if (event.key === '[') switchScene(nextSceneId(config.scene, -1));
    if (event.key === ']') switchScene(nextSceneId(config.scene, 1));
    if (event.key === 'p' || event.key === 'P') shufflePalette();
  });
  window.addEventListener('pointerdown', () => { void vibe?.start(); }, { once: false });

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

  tellHost({ type: 'ready' });
}
