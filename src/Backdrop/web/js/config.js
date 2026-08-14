// Loads config.json, then lets the host's command-line overrides win.

import { findPalette, applyPaletteToConfig, applyEnvironmentPalette } from './palettes.js?v=8';

const FALLBACK = {
  scene: 'aurora',
  paletteName: 'environment',
  render: { targetFps: 24, renderScale: 0.65, octaves: 3, adaptiveQuality: true, powerPreference: 'low-power', antialias: false },
  palette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' },
  customPalette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' },
  aurora: { intensity: 0.95, speed: 0.055, height: 0.5 },
  horizon: { y: 0.36, glow: 0.85, reflection: 0.32 },
  stars: { density: 0.8, twinkle: 0.55 },
  motes: { count: 700, color: "#cfe9ff", size: 2.8, drift: 0.35, opacity: 0.62 },
  finish: { grain: 0.028, vignette: 0.5 },
  ascii: {
    terrascii: { cellPx: 6, minCols: 80, maxCols: 480 },
    warpscii: { cellPx: 6, minCols: 80, maxCols: 480 },
    blobscii: { cellPx: 6, minCols: 80, maxCols: 480 },
  },
  hud: { enabled: false, corner: 'bottom-right', clock24h: true, locale: 'en-CA' },
  audio: { enabled: true, volume: 0.2 },
  installed: [],
  scenes: {
    aurora: { intensity: 1.6, speed: 0.16, height: 0.95, volume: 0.18 },
    terrascii: { intensity: 1.1, speed: 0.12, height: 0.7, volume: 0.08 },
    starwell: { intensity: 1.4, speed: 0.2, height: 0.9, volume: 0.16 },
    warpscii: { intensity: 1.3, speed: 0.22, height: 0.85, volume: 0.1 },
    ion: { intensity: 1.2, speed: 0.1, height: 0.8, volume: 0.14 },
    blobscii: { intensity: 1.15, speed: 0.16, height: 0.75, volume: 0.08 },
    ember: { intensity: 1.35, speed: 0.14, height: 0.8, volume: 0.2 },
    kelp: { intensity: 1.15, speed: 0.13, height: 0.75, volume: 0.22 },
    murmur: { intensity: 1.25, speed: 0.16, height: 0.7, volume: 0.18 },
  },
};

function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key.startsWith('$')) continue;
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base[key] ?? {}, value) : value;
  }
  return out;
}

export async function loadConfig() {
  let config = FALLBACK;

  try {
    const response = await fetch('./config.json', { cache: 'no-cache' });
    if (response.ok) config = merge(FALLBACK, await response.json());
  } catch (error) {
    console.warn('config.json unreadable, using defaults', error);
  }

  const query = new URLSearchParams(location.search);

  const fps = Number(query.get('fps'));
  if (Number.isFinite(fps) && fps > 0) config.render.targetFps = Math.min(fps, 144);

  const scale = Number(query.get('scale'));
  if (Number.isFinite(scale) && scale > 0) config.render.renderScale = Math.min(Math.max(scale, 0.4), 1);

  config.windowed = query.get('mode') === 'window';

  const scene = query.get('scene');
  if (scene) config.scene = scene;

  const paletteName = query.get('palette');
  if (paletteName) config.paletteName = paletteName;

  if (config.paletteName === 'environment' || !config.paletteName) {
    applyEnvironmentPalette(config, config.scene);
    config.paletteName = 'environment';
  } else if (config.paletteName === 'custom' && config.customPalette) {
    config.palette = { ...config.palette, ...config.customPalette };
    if (config.motes) config.motes.color = config.customPalette.frost;
  } else {
    const named = findPalette(config.paletteName);
    if (named) applyPaletteToConfig(config, named);
  }

  // Someone who turns motion down does not want a churning sky in their peripheral vision.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    config.aurora.speed *= 0.25;
    config.stars.twinkle = 0;
    config.motes.drift *= 0.3;
  }

  return config;
}

/** '#35e3a0' -> [0.208, 0.890, 0.627]. Kept explicit so nothing gamma-shifts behind our back. */
export function hexToRgb(hex) {
  const value = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
