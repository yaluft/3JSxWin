// Loads config.json, then lets the host's command-line overrides win.

import { findPalette, applyPaletteToConfig } from './palettes.js?v=6';

const FALLBACK = {
  scene: 'aurora',
  paletteName: 'boreal',
  render: { targetFps: 24, renderScale: 0.65, octaves: 3, adaptiveQuality: true, powerPreference: 'low-power', antialias: false },
  palette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' },
  aurora: { intensity: 0.95, speed: 0.055, height: 0.5 },
  horizon: { y: 0.36, glow: 0.85, reflection: 0.32 },
  stars: { density: 0.8, twinkle: 0.55 },
  motes: { count: 700, color: "#cfe9ff", size: 2.8, drift: 0.35, opacity: 0.62 },
  finish: { grain: 0.028, vignette: 0.5 },
  hud: { enabled: false, corner: 'bottom-right', clock24h: true, locale: 'en-CA' },
  audio: { volume: 0.2 },
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

  const named = findPalette(config.paletteName);
  if (named) applyPaletteToConfig(config, named);

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
