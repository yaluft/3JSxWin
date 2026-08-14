// Optional themes live under ./themes. Boot reads index.json only;
// theme.js is imported the first time an installed id is shown.

import { CORE_IDS, setActiveSceneIds, mergeSceneMeta, SCENE_META } from './scenes-meta.js';

const cache = new Map();
let catalog = [];
let installed = new Set();

export async function loadCatalog() {
  try {
    const response = await fetch('./themes/index.json', { cache: 'no-cache' });
    if (!response.ok) return catalog;
    const data = await response.json();
    catalog = Array.isArray(data.themes) ? data.themes : [];
    for (const entry of catalog) mergeSceneMeta(entry.id, entry);
  } catch (error) {
    console.warn('themes/index.json unreadable', error);
  }
  return catalog;
}

export function getCatalog() {
  return catalog;
}

export function setInstalled(ids) {
  const allow = new Set(catalog.map((t) => t.id));
  installed = new Set((ids ?? []).filter((id) => allow.has(id)));
  setActiveSceneIds(activeIds());
}

export function getInstalled() {
  return [...installed];
}

export function isInstalled(id) {
  return CORE_IDS.includes(id) || installed.has(id);
}

export function activeIds() {
  const extra = catalog.map((t) => t.id).filter((id) => installed.has(id));
  return [...CORE_IDS, ...extra];
}

export function resolveSceneId(id) {
  if (id && isInstalled(id) && (CORE_IDS.includes(id) || catalog.some((t) => t.id === id))) return id;
  return 'aurora';
}

export async function loadTheme(id) {
  if (!id || CORE_IDS.includes(id)) return null;
  if (cache.has(id)) return cache.get(id);
  if (!installed.has(id)) return null;
  try {
    const mod = await import(`../themes/${id}/theme.js`);
    cache.set(id, mod);
    if (mod.meta) mergeSceneMeta(mod.id ?? id, mod.meta);
    return mod;
  } catch (error) {
    console.warn('theme load failed', id, error);
    return null;
  }
}

export function dropTheme(id) {
  cache.delete(id);
}

export function sceneMeta(id) {
  return SCENE_META[id] ?? { label: id, blurb: '' };
}
