export const CORE_IDS = [
  'aurora', 'terrascii', 'warpscii', 'ion',
  'blobscii', 'glyphfall',
];

/** Active list starts as core; theme-catalog prepends installed optionals. */
export let SCENE_IDS = [...CORE_IDS];

export const SCENE_META = {
  aurora: { label: 'Aurora', blurb: 'Northern-light curtains over a dark tide' },
  terrascii: { label: 'Tube Dunes', blurb: 'Horizontal tubes riding a dune field, in density ASCII' },
  warpscii: { label: 'Tube Warp', blurb: 'A ring of tubes you fly through, in density ASCII' },
  ion: { label: 'Ion', blurb: 'Magnetic field lines and charged streaks' },
  blobscii: { label: 'Tube Loops', blurb: 'Orbiting torus tubes in density ASCII' },
  glyphfall: { label: 'Glyphfall', blurb: 'A falling-glyph cascade in density ASCII' },
};

export function setActiveSceneIds(ids) {
  SCENE_IDS = ids.length ? [...ids] : [...CORE_IDS];
}

export function mergeSceneMeta(id, meta) {
  if (!id || !meta) return;
  SCENE_META[id] = { label: meta.label ?? id, blurb: meta.blurb ?? '' };
}
