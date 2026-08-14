---
layout: default
title: Install
nav_order: 2
---

# Install
{: .no_toc }

Roughly ten minutes, most of it waiting on the SDK download.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Windows 11 (or 10 20H1+) | Desktop layer integration requires Explorer to be running normally. |
| WebView2 Runtime | Pre-installed on Windows 11. Check **Settings → Apps → Microsoft Edge WebView2 Runtime**. If missing, download the Evergreen Standalone Installer from Microsoft. |
| .NET 8 SDK (x64) | <https://dotnet.microsoft.com/download/dotnet/8.0> — get the **SDK**, not just the runtime. |

Visual Studio is not required. VS Code with the C# Dev Kit extension works, and so does a bare terminal.

---

## Step 1 — Unzip or clone

Put the project somewhere without spaces or OneDrive sync:

```
C:\dev\Win11Backdrop
```

---

## Step 2 — Confirm .NET is on PATH

Open **Windows Terminal** in that folder:

```powershell
dotnet --version
```

Expect `8.0.x` or higher. If you get "not recognized", close and reopen the terminal — the SDK installer edits PATH and existing shells do not see it.

---

## Step 3 — Build

```powershell
cd C:\dev\Win11Backdrop
.\build.ps1
```

If PowerShell blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

First run downloads the WebView2 NuGet package (needs a connection). You should end at `dist\Backdrop.exe`.

---

## Step 4 — Test in a window

```powershell
.\dist\Backdrop.exe --window
```

A 1280×720 window opens with the aurora in it. This confirms the shader compiled and your GPU is working, before anything touches your desktop. Close it when satisfied.

---

## Step 5 — Put it on the desktop

```powershell
.\dist\Backdrop.exe
```

The window disappears and the scene takes over your wallpaper, behind your icons. A small aurora icon appears in the notification area:

| Tray action | What it does |
|-------------|--------------|
| **Show in a window** | Pull the scene off the desktop |
| **Reload scene** | Pick up changes to `config.json` |
| **Open scene folder** | Jump to `dist\web\` |
| **Open DevTools** | Requires `--devtools` on the command line |
| **Open log** | `%LOCALAPPDATA%\Backdrop\backdrop.log` |
| **Quit Backdrop** | |

Double-clicking the tray icon toggles window and desktop mode.

---

## Step 6 — Multiple monitors

```powershell
.\dist\Backdrop.exe --span-all        # one continuous scene across everything
.\dist\Backdrop.exe --monitor 1       # second monitor from the left only
```

---

## Step 7 — Start with Windows

```powershell
.\install-startup.ps1
.\install-startup.ps1 -Arguments "--span-all"   # pass flags through
.\install-startup.ps1 -Remove                   # undo
```

Drops a shortcut in your Startup folder. No admin, no registry, no scheduled task.

---

## Troubleshooting

**Nothing happens when I run it.**
Check `%LOCALAPPDATA%\Backdrop\backdrop.log` — it records every startup, whether the desktop layer was found, and any scene errors.

**"Backdrop is already running."**
It is in the notification area. Expand the overflow arrow.

**It is running but I see nothing.**
Desktop mode retries silently. Check the log for `Attached to WorkerW`. If you only see `Still not attached after N attempts`, run `--diagnose` and share the output.

**The scene shows in a window but not on the desktop, or it covers my icons.**

```powershell
.\dist\Backdrop.exe --diagnose
```

The two common causes: another wallpaper tool (Wallpaper Engine, Lively, Rainmeter) already holds the layer, or `Chosen layer: None` meaning Explorer is not running normally.

**The wallpaper goes black after changing resolution or unplugging a monitor.**
Backdrop re-attaches within about four seconds. If not, use **Reload scene** from the tray.

**It is eating GPU.**
Lower `render.targetFps` to 20 and `render.renderScale` to 0.6 in `config.json`, or try:

```powershell
.\dist\Backdrop.exe --fps 20 --scale 0.6
```

**Everything is one flat colour.**
The GPU fell back to software rendering. Open `--devtools` and check the console for a shader link error.
