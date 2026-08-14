// Boreal Drift — entry point.
//
// Two passes per frame: the sky quad, then the mote field on top. The frame governor
// keeps the whole thing cheap, because this runs for hours behind everything else
// you are actually doing.

import * as THREE from 'three';
import { loadConfig } from './config.js';
import { createSky } from './sky.js';
import { createMotes } from './motes.js';
import { createHud } from './hud.js';
import { tellHost, onHostMessage, reportError } from './host.js';

// The palette is authored in sRGB and written straight to the framebuffer.
// Leaving colour management on would silently darken every hex in config.json.
THREE.ColorManagement.enabled = false;

// A 4K wallpaper does not need 4K worth of soft gradient. This is the ceiling
// before render scale is even applied.
const MAX_PIXELS = 3_600_000;

const QUALITY_LADDER = [
  { scale: 1.0, octaves: 5 },
  { scale: 0.85, octaves: 4 },
  { scale: 0.7, octaves: 4 },
  { scale: 0.55, octaves: 3 },
  { scale: 0.45, octaves: 3 },
];

boot().catch((error) => {
  reportError('boot', error);
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.hidden = false;
});

async function boot() {
  const config = await loadConfig();
  const canvas = document.getElementById('stage');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: config.render.antialias,
    alpha: false,
    powerPreference: config.render.powerPreference,
    stencil: false,
    depth: false,
  });
  renderer.autoClear = false;

  const sky = createSky(config);
  const motes = createMotes(config);
  const hud = createHud(config);

  // Start on the ladder rung closest to the configured render scale.
  let rung = nearestRung(config.render.renderScale);
  applyRung(rung, { force: true });

  const frameBudget = 1000 / config.render.targetFps;

  // Own clock rather than THREE.Clock: pausing has to be exact, or the sky jumps
  // forward the moment a full-screen game is closed.
  let elapsed = 0;
  let lastTick = performance.now();

  let running = true;
  let handle = 0;
  let lastDraw = 0;
  let drawn = 0;
  let windowStart = performance.now();

  function resize() {
    const scale = QUALITY_LADDER[rung].scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = Math.max(1, Math.round(window.innerWidth * dpr * scale));
    let height = Math.max(1, Math.round(window.innerHeight * dpr * scale));

    const over = (width * height) / MAX_PIXELS;
    if (over > 1) {
      const k = Math.sqrt(1 / over);
      width = Math.max(1, Math.round(width * k));
      height = Math.max(1, Math.round(height * k));
    }

    renderer.setSize(width, height, false);
    sky.setSize(width, height);
    motes.setSize(width, height, width / Math.max(window.innerWidth, 1));
  }

  function applyRung(index, { force = false } = {}) {
    const next = Math.min(Math.max(index, 0), QUALITY_LADDER.length - 1);
    if (!force && next === rung) return false;
    rung = next;
    sky.setOctaves(QUALITY_LADDER[rung].octaves);
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

  // Frames the machine actually managed vs frames we asked for. If it keeps falling
  // short, step down the ladder once and re-measure. Never steps back up: thrashing
  // resolution is more noticeable than running one rung low.
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

  function frame(now) {
    handle = requestAnimationFrame(frame);
    if (now - lastDraw < frameBudget - 1) return;
    elapsed += Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    lastDraw = now;

    sky.update(elapsed);
    motes.update(elapsed);
    hud.update();

    renderer.clear();
    renderer.render(sky.scene, sky.camera);
    renderer.render(motes.scene, motes.camera);

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
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(handle);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  // The host tells us when a full-screen app has covered the desktop, and relays live
  // config edits from the separate console window so the scene retunes without a reload.
  onHostMessage((message) => {
    if (message.type === 'visibility') {
      message.paused ? stop() : start();
    } else if (message.type === 'live' && message.config) {
      sky.apply(message.config);
      motes.apply(message.config);
      if (!running) start(); // show the change even if a full-screen app had paused us
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
  running = false;
  start();

  tellHost({ type: 'ready' });
}
