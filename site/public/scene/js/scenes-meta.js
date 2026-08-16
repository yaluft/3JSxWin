export const CORE_IDS = [
  'aurora', 'terrascii', 'starwell', 'warpscii', 'ion',
  'blobscii', 'ember', 'kelp', 'murmur',
  'vortex', 'plasma', 'pulsar', 'lattice', 'fracture',
];

/** Active list starts as core; theme-catalog prepends installed optionals. */
export let SCENE_IDS = [...CORE_IDS];

export const SCENE_META = {
  aurora:    { label: 'Aurora',      blurb: 'Northern-light curtains over a dark tide' },
  terrascii: { label: 'Tube Dunes',  blurb: 'Horizontal tubes riding a dune field, in density ASCII' },
  starwell:  { label: 'Starwell',    blurb: 'A warp tunnel falling toward the camera' },
  warpscii:  { label: 'Tube Warp',   blurb: 'A ring of tubes you fly through, in density ASCII' },
  ion:       { label: 'Ion',         blurb: 'Magnetic field lines and charged streaks' },
  blobscii:  { label: 'Tube Loops',  blurb: 'Orbiting torus tubes in density ASCII' },
  ember:     { label: 'Ember',       blurb: 'A rising column of cinders' },
  kelp:      { label: 'Kelp',        blurb: 'An underwater forest and muffled tide' },
  murmur:    { label: 'Murmur',      blurb: 'A starling flock turning in dusk air' },
  vortex:    { label: 'Vortex',      blurb: 'Three superposed magnetic vortices precessing and shedding wisps' },
  plasma:    { label: 'Plasma',      blurb: 'Three interference wavefronts igniting Moiré fire patterns' },
  pulsar:    { label: 'Pulsar',      blurb: 'A neutron star sweeping twin jets through magnetic latitude bands' },
  lattice:   { label: 'Lattice',     blurb: 'A crystal charge lattice trading field energy on glowing potential lines' },
  fracture:  { label: 'Fracture',    blurb: 'Lichtenberg discharge trees branching and flickering at the tips' },
};

export function setActiveSceneIds(ids) {
  SCENE_IDS = ids.length ? [...ids] : [...CORE_IDS];
}

export function mergeSceneMeta(id, meta) {
  if (!id || !meta) return;
  SCENE_META[id] = { label: meta.label ?? id, blurb: meta.blurb ?? '' };
}
