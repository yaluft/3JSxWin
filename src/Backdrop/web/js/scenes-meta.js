// scenes-meta.js — the scene registry: which backdrops exist and how they're labelled.
// Tiny on purpose. It's a shared source of truth imported by scenes.js (which draws
// them), panel.js (the console dropdown), and theme-catalog.js (which prepends the
// installed optional themes onto the active list at boot).

// The always-compiled shader scenes. These are baked into scenes.js as GLSL and can
// never fail to load, so they're the fallback set: if a catalog theme goes missing or
// the installed list is empty, we fall back to exactly these ids.
export const CORE_IDS = [
  'aurora', 'terrascii', 'warpscii', 'ion',
  'blobscii', 'glyphfall',
];

// Ids that still EXIST (so every fallback path in main.js/theme-catalog.js keeps
// working, and 'aurora' remains the guaranteed-safe scene when a catalog theme
// fails to load) but are hidden from the UI: the Win+scroll cycle, the dock
// chips and the console dropdown all skip them. This is how the roster is
// trimmed to just the image-derived space themes without having to rewrite the
// ~8 hardwired 'aurora' fallbacks — deleting them from CORE_IDS would strand the
// app with nothing to fall back to.
// To bring the presets back, empty this set.
export const HIDDEN_IDS = new Set([
  'aurora', 'terrascii', 'warpscii', 'ion', 'blobscii', 'glyphfall',
]);

/** The ids the UI should actually offer: SCENE_IDS minus anything hidden. If
 *  that filter would leave nothing at all (e.g. no catalog themes installed),
 *  fall back to the unfiltered list so the user is never left with zero scenes. */
export function visibleSceneIds() {
  const shown = SCENE_IDS.filter((id) => !HIDDEN_IDS.has(id));
  return shown.length ? shown : [...SCENE_IDS];
}

/** Active list starts as core; theme-catalog prepends installed optionals. */
// This is the *live* ordering the UI cycles through (Win+scroll / dropdown). It's a
// `let`, not a `const`, because setActiveSceneIds() swaps the whole array once the
// catalog knows which optional themes the user has installed. Spread so callers can't
// mutate CORE_IDS by holding a reference to it.
export let SCENE_IDS = [...CORE_IDS];

// Display metadata, keyed by scene id. `label` is the human name in the dropdown,
// `blurb` is the one-line description under it. Optional themes add their own entries
// here at runtime via mergeSceneMeta(), so this object grows after boot — it is not
// the complete list, just what's known so far.
export const SCENE_META = {
  aurora: { label: 'Aurora', blurb: 'Northern-light curtains over a dark tide' },
  terrascii: { label: 'Tube Dunes', blurb: 'Horizontal tubes riding a dune field, in density ASCII' },
  warpscii: { label: 'Tube Warp', blurb: 'A ring of tubes you fly through, in density ASCII' },
  ion: { label: 'Ion', blurb: 'Magnetic field lines and charged streaks' },
  blobscii: { label: 'Tube Loops', blurb: 'Orbiting torus tubes in density ASCII' },
  glyphfall: { label: 'Glyphfall', blurb: 'A falling-glyph cascade in density ASCII' },
};

// Replace the active list wholesale. theme-catalog calls this with
// [...CORE_IDS, ...installedOptionals] whenever the installed set changes. An empty
// array is treated as "nothing installed" and resets to core only, so a bad catalog
// can't leave the user with zero scenes to cycle.
export function setActiveSceneIds(ids) {
  SCENE_IDS = ids.length ? [...ids] : [...CORE_IDS];
}

// Register (or update) the label/blurb for a scene id. Used for optional themes:
// theme-catalog calls this from index.json at boot and again from the theme module's
// own `meta` once theme.js is actually imported (the module's copy wins, it's fresher).
// Guards against null id/meta, and fills in sensible defaults so a half-specified
// theme still shows *something* rather than "undefined" in the dropdown.
export function mergeSceneMeta(id, meta) {
  if (!id || !meta) return;
  SCENE_META[id] = { label: meta.label ?? id, blurb: meta.blurb ?? '' };
}
