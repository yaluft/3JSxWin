// theme-catalog.js — the lazy loader for OPTIONAL scenes (the ones that aren't
// baked into scenes.js). Optional themes live under ./themes/<id>/theme.js.
// The rule that shapes this whole file: boot must stay cheap, so at startup we
// fetch ONLY themes/index.json (a tiny manifest of id + label + blurb). The
// actual theme.js module — three.js code, shaders, textures — is import()ed the
// first time an installed theme is asked to render, and never before.
//
// Three sets of state, and it matters which is which:
//   catalog   — everything index.json advertises (may or may not be installed)
//   installed — the subset the user has actually turned on (from config.installed)
//   cache     — theme id -> the already-import()ed module, so we import once

import { CORE_IDS, setActiveSceneIds, mergeSceneMeta, SCENE_META } from './scenes-meta.js';

// id -> loaded ES module. loadTheme() fills this on first successful import and
// reads it on every call after, so a theme's theme.js is fetched and evaluated
// exactly once per session. dropTheme() evicts an entry if a theme is uninstalled.
const cache = new Map();
// What index.json advertised this boot. An array of { id, label, blurb, ... }.
// Empty until loadCatalog() runs; empty forever if there's no themes/ folder.
let catalog = [];
// The ids the user has enabled. Always a subset of catalog ids (setInstalled
// filters against the catalog), so we can never "install" a theme we have no
// manifest entry for.
let installed = new Set();

// Called once at boot (from main.js, before the scene list is built). Fetches the
// manifest and nothing else — no theme.js is touched here. This is the ONLY
// network request the catalog makes at startup.
export async function loadCatalog() {
  try {
    // cache: 'no-cache' forces a revalidation every boot, same reasoning as
    // config.json: the settings panel / an install step can rewrite index.json
    // in place and we must see that on the next launch, not a stale disk copy.
    const response = await fetch('./themes/index.json', { cache: 'no-cache' });
    // No themes/ folder, or a 404 on a stripped deploy: not an error. The app
    // just runs core-only. catalog stays [] and every guard below short-circuits.
    if (!response.ok) return catalog;
    const data = await response.json();
    // Defensive: only accept a real array under `themes`. A malformed manifest
    // leaves us core-only rather than crashing the boot path.
    catalog = Array.isArray(data.themes) ? data.themes : [];
    // Seed the dropdown label/blurb for each advertised theme NOW, from the
    // manifest, so the scene menu can name a theme before its theme.js is ever
    // imported. The module's own `meta` overrides this later (see loadTheme).
    for (const entry of catalog) mergeSceneMeta(entry.id, entry);
  } catch (error) {
    // Malformed JSON or a fetch failure — log and carry on core-only.
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
  const extra = catalog
    .map((t) => t.id)
    .filter((id) => installed.has(id) && !CORE_IDS.includes(id));
  return [...CORE_IDS, ...extra];
}

export function resolveSceneId(id) {
  if (id && isInstalled(id) && (CORE_IDS.includes(id) || catalog.some((t) => t.id === id))) return id;
  return 'aurora';
}

/** Catalog ids requested via ?scene= or config.scene must be installed or they boot as Aurora. */
export function ensureInstalled(id) {
  if (!id || CORE_IDS.includes(id)) return false;
  if (!catalog.some((t) => t.id === id)) return false;
  if (installed.has(id)) return false;
  installed.add(id);
  setActiveSceneIds(activeIds());
  return true;
}

export async function loadTheme(id) {
  if (!id || CORE_IDS.includes(id)) return null;
  if (cache.has(id)) return cache.get(id);
  if (!installed.has(id)) return null;
  try {
    // Absolute URL from this module: WebView2 virtual-host mapping is picky about
    // relative dynamic import() specifiers (Chrome is not).
    const href = new URL(`../themes/${id}/theme.js`, import.meta.url).href;
    const mod = await import(href);
    if (!mod?.fragment) {
      console.warn('theme has no fragment', id);
      return null;
    }
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
