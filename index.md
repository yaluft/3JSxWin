---
layout: home
title: Home
nav_order: 1
---

# 3JSxWin

A live [three.js](https://threejs.org) scene as a Windows 11 wallpaper. It sits on the real desktop `WorkerW` layer — behind your icons, behind the taskbar — hosted in WebView2 from a small WPF app.

<p align="center">
  <img src="{{ '/docs/site-preview.gif' | relative_url }}" alt="Aurora wallpaper demo" style="max-width:720px;border-radius:8px;" />
</p>

---

## What it does

- Sixteen scenes: aurora, ASCII tube fields, a moving Great Wave, and five nature scenes that generate their own soundscapes
- Renders straight onto the `WorkerW` desktop layer, so icons stay clickable and the taskbar stays on top
- Duplicates across monitors at native resolution by default, or spans all of them as one canvas
- Windowed preview mode so you can test before committing to the desktop
- Live scene tuning from an on-screen console (`Ctrl+Alt+B`)
- Palette randomizer over twelve real Neovim themes
- Tray controls for reload, mode toggle, layout, DevTools, and diagnostics
- Startup shortcut installer — no registry, no admin

## Quick links

| Page | Description |
| --- | --- |
| [Install]({% link docs/pages/install.md %}) | The one-liner, and the source build |
| [Configure]({% link docs/pages/configure.md %}) | `config.json` reference |
| [Contributing]({% link docs/pages/contributing.md %}) | Learning path and PR guidelines |
| [Credits]({% link docs/pages/credits.md %}) | Libraries and inspiration |

The live site, installer, and an in-browser preview of the scene are at [yakupov.xyz](https://yakupov.xyz/).

## Get started

```powershell
irm https://yakupov.xyz/install.ps1 | iex
```

Or build it yourself:

```powershell
git clone https://github.com/yaluft/3JSxWin.git
cd 3JSxWin
.\build.ps1
.\dist\Backdrop.exe --window   # test in a window first
```

See the [Install guide]({% link docs/pages/install.md %}) for prerequisites and step-by-step instructions.
