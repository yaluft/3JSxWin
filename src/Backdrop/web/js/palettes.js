// Neovim colorscheme palettes, mapped onto Backdrop's five slots.
// Hex values taken from the upstream GitHub repos cited on each entry.
// ENV_PALETTES are place-specific five-slots; paletteName "environment" follows the scene.

export const ENV_PALETTES = {
  aurora:     { label: 'Boreal night',   palette: { void: '#04060c', tide: '#0b2233', verdant: '#35e3a0', iris: '#6e5bff', frost: '#cfe9ff' } },
  terrascii:  { label: 'Dune brass',     palette: { void: '#140c06', tide: '#2a1a0c', verdant: '#d4a017', iris: '#c45c26', frost: '#f3e2b8' } },
  starwell:   { label: 'Well violet',    palette: { void: '#05010c', tide: '#12082a', verdant: '#3dffc8', iris: '#b44dff', frost: '#e8d7ff' } },
  warpscii:   { label: 'Tunnel neon',    palette: { void: '#06030a', tide: '#1a0a28', verdant: '#00f0c8', iris: '#ff4ad2', frost: '#f5e6ff' } },
  ion:        { label: 'Magnetosphere',  palette: { void: '#030712', tide: '#0a1630', verdant: '#4de4ff', iris: '#7a5cff', frost: '#dcecff' } },
  blobscii:   { label: 'Ink loops',      palette: { void: '#07080c', tide: '#12161e', verdant: '#7dff6a', iris: '#5b8cff', frost: '#e8fff0' } },
  ember:      { label: 'Cinder hearth',  palette: { void: '#0c0503', tide: '#2a0e08', verdant: '#ff7a2e', iris: '#ff3b1a', frost: '#ffd7a8' } },
  kelp:       { label: 'Trench green',   palette: { void: '#021014', tide: '#04302c', verdant: '#2ee6a0', iris: '#147a88', frost: '#b8ffe8' } },
  murmur:     { label: 'Dusk flock',     palette: { void: '#0e0a10', tide: '#2a1820', verdant: '#e0a05a', iris: '#8a5a78', frost: '#f0d8c0' } },
  mycelight:  { label: 'Soil circuit',   palette: { void: '#070805', tide: '#12180e', verdant: '#7dffb0', iris: '#3d6b48', frost: '#e8fff2' } },
  coralnet:   { label: 'Reef night',     palette: { void: '#031018', tide: '#06283a', verdant: '#3ad7c0', iris: '#ff6b8a', frost: '#d4fff6' } },
  inkatrium:  { label: 'Droplet city',   palette: { void: '#06040c', tide: '#161022', verdant: '#e8c36a', iris: '#6a4cff', frost: '#fff4d0' } },
  orreryheart:{ label: 'Brass pulse',    palette: { void: '#0c0606', tide: '#2a1010', verdant: '#e8a040', iris: '#c43030', frost: '#ffe0b8' } },
  threadloom: { label: 'Nerve linen',    palette: { void: '#0c0a08', tide: '#221c16', verdant: '#c8a070', iris: '#d07090', frost: '#f4e8d8' } },
  orbis:      { label: 'Orbital day',    palette: { void: '#02040c', tide: '#0a2048', verdant: '#2f9e5a', iris: '#3d6ad9', frost: '#e6f2ff' } },
  atoll:      { label: 'Noon lagoon',    palette: { void: '#0a1c28', tide: '#0e6a8a', verdant: '#3dcc6e', iris: '#7ec8ff', frost: '#fff6d8' } },
  ringfall:   { label: 'Ice ring',       palette: { void: '#04060c', tide: '#12182a', verdant: '#8ad4e8', iris: '#c4a46a', frost: '#f2f0e6' } },
  nimbus:     { label: 'Storm pearl',    palette: { void: '#0c1016', tide: '#2a3444', verdant: '#8aa8b8', iris: '#6a7a98', frost: '#e8eef4' } },
  shoal:      { label: 'Sandbar noon',   palette: { void: '#0c2830', tide: '#1288a8', verdant: '#e8d090', iris: '#40c8d8', frost: '#fff8e8' } },
  caldera:    { label: 'Magma dusk',     palette: { void: '#0a0608', tide: '#1c1014', verdant: '#c45a28', iris: '#ff4a18', frost: '#ffc890' } },
  bayline:    { label: 'Tokyo night',    palette: { void: '#16161e', tide: '#1a1b26', verdant: '#7aa2f7', iris: '#f7768e', frost: '#c0caf5' } },
};

export const PALETTES = [
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    source: 'https://github.com/catppuccin/catppuccin',
    palette: { void: '#11111b', tide: '#1e1e2e', verdant: '#a6e3a1', iris: '#cba6f7', frost: '#cdd6f4' },
  },
  {
    id: 'tokyonight',
    label: 'Tokyo Night',
    source: 'https://github.com/folke/tokyonight.nvim',
    palette: { void: '#16161e', tide: '#1a1b26', verdant: '#9ece6a', iris: '#bb9af7', frost: '#c0caf5' },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    source: 'https://github.com/rose-pine/neovim',
    palette: { void: '#191724', tide: '#1f1d2e', verdant: '#31748f', iris: '#c4a7e7', frost: '#e0def4' },
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    source: 'https://github.com/rebelot/kanagawa.nvim',
    palette: { void: '#16161d', tide: '#1f1f28', verdant: '#98bb6c', iris: '#957fb8', frost: '#dcd7ba' },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    source: 'https://github.com/ellisonleao/gruvbox.nvim',
    palette: { void: '#1d2021', tide: '#282828', verdant: '#b8bb26', iris: '#d3869b', frost: '#ebdbb2' },
  },
  {
    id: 'nord',
    label: 'Nord',
    source: 'https://github.com/gbprod/nord.nvim',
    palette: { void: '#2e3440', tide: '#3b4252', verdant: '#a3be8c', iris: '#b48ead', frost: '#eceff4' },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    source: 'https://github.com/sainnhe/everforest',
    palette: { void: '#1e2326', tide: '#272e33', verdant: '#a7c080', iris: '#d699b6', frost: '#d3c6aa' },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    source: 'https://github.com/Mofiqul/dracula.nvim',
    palette: { void: '#191a21', tide: '#282a36', verdant: '#50fa7b', iris: '#bd93f9', frost: '#f8f8f2' },
  },
  {
    id: 'onedark',
    label: 'One Dark',
    source: 'https://github.com/navarasu/onedark.nvim',
    palette: { void: '#1e222a', tide: '#282c34', verdant: '#98c379', iris: '#c678dd', frost: '#abb2bf' },
  },
  {
    id: 'oxocarbon',
    label: 'Oxocarbon',
    source: 'https://github.com/nyoom-engineering/oxocarbon.nvim',
    palette: { void: '#161616', tide: '#262626', verdant: '#42be65', iris: '#be95ff', frost: '#f2f4f8' },
  },
  {
    id: 'carbonfox',
    label: 'Carbonfox',
    source: 'https://github.com/EdenEast/nightfox.nvim',
    palette: { void: '#0c0c0c', tide: '#161616', verdant: '#25be6a', iris: '#be95ff', frost: '#f2f4f8' },
  },
  {
    id: 'solarized-osaka',
    label: 'Solarized Osaka',
    source: 'https://github.com/craftzdog/solarized-osaka.nvim',
    palette: { void: '#00141a', tide: '#002b36', verdant: '#859900', iris: '#6c71c4', frost: '#eee8d5' },
  },
];

export function findPalette(id) {
  if (!id || id === 'environment') return null;
  const named = PALETTES.find((entry) => entry.id === id);
  if (named) return named;
  if (id.startsWith('env-')) {
    const env = ENV_PALETTES[id.slice(4)];
    if (env) return { id, label: env.label, palette: env.palette };
  }
  return null;
}

export function environmentFor(sceneId, extra) {
  if (extra?.palette) {
    return {
      id: 'environment',
      label: extra.paletteLabel ?? extra.meta?.label ?? sceneId,
      palette: extra.palette,
    };
  }
  const env = ENV_PALETTES[sceneId] ?? ENV_PALETTES.aurora;
  return { id: 'environment', label: env.label, palette: env.palette };
}

export function applyEnvironmentPalette(config, sceneId, extra) {
  const env = environmentFor(sceneId, extra);
  config.palette = { ...config.palette, ...env.palette };
  if (config.motes) config.motes.color = env.palette.frost;
  return env;
}

export function registerEnvPalette(sceneId, spec) {
  if (!sceneId || !spec?.palette) return;
  ENV_PALETTES[sceneId] = {
    label: spec.label ?? ENV_PALETTES[sceneId]?.label ?? sceneId,
    palette: spec.palette,
  };
}

export function randomPalette(exceptId) {
  const pool = PALETTES.filter((entry) => entry.id !== exceptId);
  return pool[Math.floor(Math.random() * pool.length)] ?? PALETTES[0];
}

export function applyPaletteToConfig(config, entry) {
  config.paletteName = entry.id;
  if (entry.id === 'environment') {
    return applyEnvironmentPalette(config, config.scene);
  }
  if (entry.id === 'custom') {
    const custom = config.customPalette;
    if (custom) {
      config.palette = { ...config.palette, ...custom };
      if (config.motes) config.motes.color = custom.frost;
    }
    return config;
  }
  config.palette = { ...config.palette, ...entry.palette };
  if (config.motes) config.motes.color = entry.palette.frost;
  return config;
}
