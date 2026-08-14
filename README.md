# 3JSxWin

[![docs](https://img.shields.io/badge/docs-yaluft.github.io%2F3JSxWin-blue?style=flat-square)](https://yaluft.github.io/3JSxWin/)
[![build](https://github.com/yaluft/3JSxWin/actions/workflows/build.yml/badge.svg)](https://github.com/yaluft/3JSxWin/actions/workflows/build.yml)
[![lint](https://github.com/yaluft/3JSxWin/actions/workflows/lint.yml/badge.svg)](https://github.com/yaluft/3JSxWin/actions/workflows/lint.yml)

A Windows 11 desktop wallpaper app that renders a live three.js aurora scene behind your icons and taskbar, using WebView2, WPF, and Win32 desktop integration.

📖 **[Full documentation →](https://yaluft.github.io/3JSxWin/)**

This project is for developers who enjoy desktop composition, GPU shaders, live UI tuning, and experimenting with the Microsoft Windows desktop ecosystem.

## Demo video

<p align="center">
  <video src="https://github.com/yaluft/3JSxWin/raw/main/Recording%202026-08-13%20234900.mp4" controls muted playsinline width="100%"></video>
</p>

## Why this project exists

The goal is simple: make a highly customisable, visually rich wallpaper that behaves like a real desktop layer, while keeping the code easy to explore and tweak.

It is designed for:

- Windows 11 desktop experimentation
- three.js visual prototyping
- WebView2 + WPF desktop hosts
- Win32/Explorer integration work
- GPU shader tuning and live config editing

## Call for contributors

If you are a developer who likes Windows internals, WebView2, WPF, shader work, GPU rendering, or desktop UX, this project is a great place to contribute.

We especially welcome help in these areas:

- multi-monitor fixes and layout improvements
- better desktop attach reliability
- performance tuning for low-end GPUs
- config UX and preset systems
- shader polish and rendering quality
- Windows compatibility and diagnostics

Open an issue, start a discussion, or send a PR if you have an improvement, bug fix, or feature idea.

## Related Microsoft ecosystem and inspiration

This project sits in the same general space as the Microsoft desktop and developer tooling ecosystem, including:

- [Microsoft](https://github.com/microsoft)
- [Microsoft/WindowsAppSDK](https://github.com/microsoft/WindowsAppSDK)
- [Microsoft/WinUI-Gallery](https://github.com/microsoft/WinUI-Gallery)
- [Microsoft/PowerToys](https://github.com/microsoft/PowerToys)
- [Microsoft/terminal](https://github.com/microsoft/terminal)
- [dotnet/windowsdesktop](https://github.com/dotnet/windowsdesktop)

This project also benefited from exploring modern desktop and browser hosting patterns in the Windows ecosystem, and from working with Claude during the design and debugging process.

## Features

- Live aurora wallpaper rendered in a real desktop layer
- WebView2-hosted scene with a full-screen three.js canvas
- One continuous scene across multiple monitors
- Windowed preview mode for safe testing before desktop takeover
- Tray controls for showing the scene in a window, reloading config, and diagnostics
- Live scene tuning via an on-screen console
- Startup shortcut installation for launching automatically
- Log and diagnostic tooling for troubleshooting Explorer/desktop attachment issues

---

## Install

Roughly ten minutes, most of it waiting on the SDK download.

## 0. What you need

| | |
| --- | --- |
| Windows 11 | Windows 10 20H1+ also works. |
| WebView2 Runtime | **Already installed on Windows 11.** Check: Settings → Apps → Installed apps → "Microsoft Edge WebView2 Runtime". If missing, get the Evergreen Standalone Installer from Microsoft. |
| .NET 8 SDK | <https://dotnet.microsoft.com/download/dotnet/8.0> — the **SDK**, x64, not just the runtime. |

Visual Studio is not required. If you already have it with the **.NET desktop development** workload, opening `Win11Backdrop.sln` works too.

## 1. Unzip

Put it somewhere without spaces or OneDrive sync:

```text
C:\dev\Win11Backdrop
```

## 2. Confirm the SDK is on PATH

Open **Windows Terminal** in that folder and run:

```powershell
dotnet --version
```

Expect `8.0.x` or higher. If you get "not recognized", close and reopen the terminal — the installer edits PATH and existing shells do not see it.

## 3. Build

```powershell
cd C:\dev\Win11Backdrop
.\build.ps1
```

If PowerShell blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

First run downloads the WebView2 NuGet package, so it needs a connection. You should end at `dist\Backdrop.exe`.

## 4. Test in a window first

```powershell
.\dist\Backdrop.exe --window
```

A 1280×720 window opens with the aurora in it. This tells you the shader compiled and your GPU is fine, before anything touches your desktop. Close it when satisfied.

## 5. Put it on the desktop

```powershell
.\dist\Backdrop.exe
```

The window disappears and the scene takes over your wallpaper, behind your icons. A small aurora icon appears in the notification area — that is how you get back to it:

- **Show in a window** — pull it off the desktop
- **Reload scene** — after editing `config.json`
- **Open scene folder** — jumps to `dist\web\`
- **Open DevTools** — needs `--devtools` on the command line
- **Open log** — `%LOCALAPPDATA%\Backdrop\backdrop.log`
- **Quit Backdrop**

Double-clicking the tray icon toggles window and desktop mode.

## 6. Multiple monitors

```powershell
.\dist\Backdrop.exe --span-all        # one continuous scene across everything
.\dist\Backdrop.exe --monitor 1       # the second monitor from the left, only
```

## 7. Start it with Windows

```powershell
.\install-startup.ps1
.\install-startup.ps1 -Arguments "--span-all"   # pass flags through
.\install-startup.ps1 -Remove                   # undo
```

This drops a shortcut in your Startup folder. No admin, no registry, no scheduled task.

## 8. Make it yours

**Tap `Ctrl+Alt+B`** to open the on-scene console — a floating, draggable terminal-style window with sliders and colour pickers for the aurora, horizon, sky, motes, palette, and clock. Every change previews live. While it's open the scene is a normal clickable window; drag the console by its title bar. **Tap `Ctrl+Alt+B` again, press `Esc`, or click `×`** to close it — the scene drops back behind your icons and stops taking input.

Changes are **not** written until you click **SAVE** (values go to `config.json` so they survive a restart); closing without saving discards them. Controls marked `*` (mote count, clock) can't change on a running scene, so SAVE reloads it once to pick them up. **RESET** restores the previous saved config from its automatic `.bak`.

For hand-editing instead: `dist\web\config.json` → edit → **Reload scene** from the tray. Start with:

```jsonc
"aurora":  { "intensity": 0.95, "speed": 0.055, "height": 0.5 },
"horizon": { "y": 0.36, "glow": 0.85, "reflection": 0.32 }
```

Push `horizon.y` up to `0.5` for a wider sky, or `intensity` to `1.4` for something much louder. Editing `src\Backdrop\web\config.json` instead makes the change survive the next build.

### Built on three.js

The scene is a [three.js](https://github.com/mrdoob/three.js) renderer (r185, vendored, MIT). If you want to push the visuals further, the official [three.js examples](https://threejs.org/examples/) are the best starting point — the aurora is a full-screen shader quad and the motes are a GPU-animated points field, both lifted from patterns in that gallery. See [CREDITS.md](CREDITS.md) for the specific examples each part follows.

---

## If it goes wrong

**Nothing happens when I run it.**
Check `%LOCALAPPDATA%\Backdrop\backdrop.log`. It records every startup, whether the desktop layer was found, and any scene errors.

**"Backdrop is already running."**
It is in the notification area. Expand the overflow arrow.

**It is running but I see nothing.**
Desktop mode no longer degrades into a window — it retries silently instead. Check the log for `Attached to WorkerW ...`. If you only see `Still not attached after N attempts`, run `--diagnose` and send that report.

**The scene shows in a window but not on the desktop, or it covers my icons.**
Run the diagnostic — it prints exactly which desktop windows Explorer is handing out on your machine and which one Backdrop picked:

```powershell
.\dist\Backdrop.exe --diagnose
```

The report is also on **Copy diagnostics** in the tray menu, and it goes into the log either way. Paste it and the cause is usually obvious in one line. The two common ones are another wallpaper tool already holding the layer (close Wallpaper Engine, Lively, or Rainmeter and retry), and `Chosen layer : None`, which means Explorer is not running normally.

**The wallpaper goes black after changing resolution or unplugging a monitor.**
Backdrop re-attaches within about four seconds. If not, **Reload scene** from the tray.

**It came back to my old wallpaper after a reboot.**
Expected unless you did step 7 — nothing is installed, it is just a running process.

**It is eating GPU.**
Lower `render.targetFps` to 20 and `render.renderScale` to 0.6 in `config.json`, or launch with `--fps 20 --scale 0.6` to try values before committing them.

**"dotnet is not recognized" / NU1101 package errors.**
Step 2, and confirm you can reach nuget.org.

**Everything is one flat colour.**
The GPU fell back to software rendering. `--devtools`, then check the console for a shader link error and paste it in — that is the one failure the log cannot explain on its own.

---

## Contributing

This project is intentionally small enough to read in an afternoon, but broad enough to touch a lot of interesting desktop and graphics territory. If you want to improve or extend it, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [three.js](https://github.com/mrdoob/three.js)
- [Microsoft WebView2](https://learn.microsoft.com/microsoft-edge/webview2/)
- [Microsoft](https://github.com/microsoft)
- [Claude](https://claude.ai/) for design and debugging support during development
