// Neovim colorscheme palettes, mapped onto Backdrop's five slots.
// Hex values taken from the upstream GitHub repos cited on each entry.

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
  return PALETTES.find((entry) => entry.id === id) ?? null;
}

export function randomPalette(exceptId) {
  const pool = PALETTES.filter((entry) => entry.id !== exceptId);
  return pool[Math.floor(Math.random() * pool.length)] ?? PALETTES[0];
}

export function applyPaletteToConfig(config, entry) {
  config.paletteName = entry.id;
  config.palette = { ...config.palette, ...entry.palette };
  if (config.motes) config.motes.color = entry.palette.frost;
  return config;
}
