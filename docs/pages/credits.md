---
layout: default
title: Credits
nav_order: 5
---

# Credits

## Built with Claude

Backdrop was designed and written in collaboration with **[Claude](https://claude.ai)** by [Anthropic](https://anthropic.com) — specifically Claude Opus 4.6, working from the Microsoft Learn documentation for the WebView2 and Win32 surface area.

Claude wrote the initial implementation, then found and fixed four real bugs during review:

| Bug | Why it mattered |
| --- | --- |
| `GetParent` used to verify `SetParent` | Returns the *owner*, not the parent, for a `WS_POPUP` window. A working attach reported as failed. |
| `SetParent` return value checked for null | Null is the previous parent of a top-level window — success and failure look identical. |
| `SWP_NOZORDER` after re-parenting | `SetParent` inserts at the top of the sibling z-order, putting the scene over the desktop icons. |
| `$args` in `build.ps1` | A PowerShell automatic variable, unavailable inside `[CmdletBinding()]`. Splatting it silently misfired. |

Commits made in collaboration carry a `Co-Authored-By: Claude <noreply@anthropic.com>` trailer. `git-push.ps1` adds it automatically.

---

## Third party

- **[three.js](https://threejs.org)** — r185, MIT. Vendored in `src/Backdrop/web/vendor/`. Scene patterns from:
  - [`webgl_shaders_ocean`](https://threejs.org/examples/#webgl_shaders_ocean) — full-screen shader surface
  - [`webgl_points_sprites`](https://threejs.org/examples/#webgl_points_sprites) — GPU-animated point field
  - [`webgl_buffergeometry_custom_attributes_particles`](https://threejs.org/examples/#webgl_buffergeometry_custom_attributes_particles) — per-particle attributes
- **[anime.js](https://animejs.com/)** — v3.2.2, MIT, © Julian Garnier. Vendored too, and used by the one 2D scene, Pulse.
- **[Microsoft.Web.WebView2](https://learn.microsoft.com/microsoft-edge/webview2/)** — Chromium host, pulled from NuGet at build time.

---

## Palettes

The palette randomizer ships twelve colour schemes lifted from real Neovim themes — only the five colours each scene needs, no code. Every one is credited in `web/js/palettes.js` with a link to its source:

[Catppuccin](https://github.com/catppuccin/catppuccin) ·
[Tokyo Night](https://github.com/folke/tokyonight.nvim) ·
[Rosé Pine](https://github.com/rose-pine/neovim) ·
[Kanagawa](https://github.com/rebelot/kanagawa.nvim) ·
[Gruvbox](https://github.com/ellisonleao/gruvbox.nvim) ·
[Nord](https://github.com/gbprod/nord.nvim) ·
[Everforest](https://github.com/sainnhe/everforest) ·
[Dracula](https://github.com/Mofiqul/dracula.nvim) ·
[One Dark](https://github.com/navarasu/onedark.nvim) ·
[Oxocarbon](https://github.com/nyoom-engineering/oxocarbon.nvim) ·
[Carbonfox](https://github.com/EdenEast/nightfox.nvim) ·
[Solarized Osaka](https://github.com/craftzdog/solarized-osaka.nvim)

The thirteenth, Boreal, is the project's own default.

---

## Prior art

The `WorkerW` re-parenting technique is folklore that predates this project. [Wallpaper Engine](https://www.wallpaperengine.io/), [Lively Wallpaper](https://github.com/rocksdanister/lively), and many blog posts arrived at the same `0x052C` message independently. Backdrop's contribution is documenting *why* each step is needed, in `Interop/DesktopLayer.cs`.

The hex ASCII scene takes its look from [DeoVolenteGames' ascii-renderer](https://deovolentegames.github.io/ascii-renderer/) ([@DeoVolenteGames](https://github.com/DeoVolenteGames)) — the density ramp and tinted-ink treatment, reimplemented here as a shader pass.

The Kanagawa scene is after Hokusai's *The Great Wave off Kanagawa* (c. 1831, public domain).
