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
- **[Microsoft.Web.WebView2](https://learn.microsoft.com/microsoft-edge/webview2/)** — Chromium host, pulled from NuGet at build time.

---

## Prior art

The `WorkerW` re-parenting technique is folklore that predates this project. [Wallpaper Engine](https://www.wallpaperengine.io/), [Lively Wallpaper](https://github.com/rocksdanister/lively), and many blog posts arrived at the same `0x052C` message independently. Backdrop's contribution is documenting *why* each step is needed, in `Interop/DesktopLayer.cs`.
