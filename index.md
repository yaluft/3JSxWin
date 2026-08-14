---
layout: home
title: Home
nav_order: 1
---

# Win11Backdrop

A Windows 11 desktop wallpaper app that renders a live **three.js aurora scene** behind your icons and taskbar, using WebView2, WPF, and Win32 desktop integration.

<!-- lychee-ignore-start -->
<p align="center">
  <img src="{{ '/assets/video/preview.gif' | relative_url }}" alt="Aurora wallpaper demo" style="max-width:720px;border-radius:8px;" />
</p>
<!-- lychee-ignore-end -->

---

## What it does

- Renders a live aurora shader directly on the `WorkerW` desktop layer
- Spans one continuous scene across multiple monitors
- Windowed preview mode so you can test before committing to the desktop
- Live scene tuning via an on-screen console (`Ctrl+Alt+B`)
- Tray controls for reload, mode toggle, DevTools, and diagnostics
- Startup shortcut installer — no registry, no admin

## Quick links

| Page | Description |
|------|-------------|
| [Install]({% link docs/pages/install.md %}) | Full setup guide, ~10 minutes |
| [Configure]({% link docs/pages/configure.md %}) | `config.json` reference |
| [Contributing]({% link docs/pages/contributing.md %}) | Learning path and PR guidelines |
| [Credits]({% link docs/pages/credits.md %}) | Libraries and inspiration |

## Get started

```powershell
git clone https://github.com/yaluft/3JSxWin.git
cd 3JSxWin
.\build.ps1
.\dist\Backdrop.exe --window   # test in a window first
```

See the [Install guide]({% link docs/pages/install.md %}) for full prerequisites and step-by-step instructions.
