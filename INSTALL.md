# Install

Two ways in. If you just want the wallpaper running, take the one-liner below. If you
want to change the code, build from source — that is the rest of this page, roughly ten
minutes with most of it waiting on the SDK download.

Store listing (not implemented in this tree): [docs/publish-ms-store.md](docs/publish-ms-store.md).

## The short way

```powershell
irm https://yakupov.xyz/install.ps1 | iex
```

That downloads the current zip into `%LOCALAPPDATA%\3JSxWin`, pulls the .NET 8 Desktop
Runtime through winget if it is missing, adds a Startup shortcut, and opens a preview
window. No SDK, no admin, no build. To undo it:

```powershell
irm https://yakupov.xyz/install.ps1 -OutFile $env:TEMP\3jsxwin-install.ps1
& $env:TEMP\3jsxwin-install.ps1 -Uninstall
```

Full notes: [yakupov.xyz/install](https://yakupov.xyz/install). Everything below is the
source build.

## 0. What you need to build

| | |
| --- | --- |
| Windows 11 | Windows 10 20H1+ also works. |
| WebView2 Runtime | **Already installed on Windows 11.** Check: Settings → Apps → Installed apps → "Microsoft Edge WebView2 Runtime". If missing, get the Evergreen Standalone Installer from Microsoft. |
| .NET 8 SDK | <https://dotnet.microsoft.com/download/dotnet/8.0> — the **SDK**, x64, not just the runtime. |

Visual Studio is not required. If you already have it with the **.NET desktop
development** workload, opening `Win11Backdrop.sln` works too.

## 1. Get the source

Put it somewhere without spaces or OneDrive sync:

```powershell
git clone https://github.com/yaluft/3JSxWin.git C:\dev\3JSxWin
```

## 2. Confirm the SDK is on PATH

Open **Windows Terminal** in that folder and run:

```powershell
dotnet --version
```

Expect `8.0.x` or higher. If you get "not recognized", close and reopen the terminal —
the installer edits PATH and existing shells do not see it.

## 3. Build

```powershell
cd C:\dev\3JSxWin
.\build.ps1
```

If PowerShell blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

First run downloads the WebView2 NuGet package, so it needs a connection. You should
end at `dist\Backdrop.exe`.

## 4. Test in a window first

```powershell
.\dist\Backdrop.exe --window
```

A 1280×720 window opens with the aurora in it. This tells you the shader compiled and
your GPU is fine, before anything touches your desktop. Press `]` and `[` to walk
through the other eight core scenes and `P` to shuffle the palette. Close it when
satisfied.

## 5. Put it on the desktop

```powershell
.\dist\Backdrop.exe
```

The window disappears and the scene takes over your wallpaper, behind your icons. A
small aurora icon appears in the notification area — that is how you get back to it:

- **Show in a window** — pull it off the desktop
- **Desktop layout** — single monitor, span all, or duplicate on every monitor
- **Reload scene** — after editing `config.json`
- **Open scene folder** — jumps to `dist\web\`
- **Open DevTools** — needs `--devtools` on the command line
- **Open log** — `%LOCALAPPDATA%\Backdrop\backdrop.log`
- **Copy diagnostics** — the `--diagnose` report, on the clipboard
- **Quit Backdrop** — and **Kill Backdrop** if a shutdown ever hangs

Double-clicking the tray icon toggles window and desktop mode.

Win+`]` and Win+`[` change scene, Win+`P` shuffles the palette. The chords need Win
here because the wallpaper never holds focus.

## 6. Multiple monitors

With two or more displays the default is **duplicate** — one scene per monitor at its
native resolution. A tray pick under **Desktop layout** is remembered for next launch;
a flag beats both:

```powershell
.\dist\Backdrop.exe --duplicate-all   # one copy per monitor (the dual-screen default)
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

`Ctrl+Alt+B` opens a floating console with sliders and colour pickers for the whole
scene. Changes preview live; **SAVE** writes them to `config.json` and **RESET** goes
back to the last save.

To hand-edit instead: `dist\web\config.json` → edit → **Reload scene** from the tray.
The shipped values are

```jsonc
"aurora":  { "intensity": 1.6, "speed": 0.16, "height": 0.95 },
"horizon": { "y": 0.30, "glow": 1.2, "reflection": 0.65 }
```

Drop `aurora.intensity` toward `0.9` for something calmer, or push `horizon.y` up
toward `0.5` to raise the horizon line and get more reflected water. Editing
`src\Backdrop\web\config.json` instead makes the change survive the next build. Every
key is listed in [docs/pages/configure.md](docs/pages/configure.md).

---

## If it goes wrong

**Nothing happens when I run it.**
Check `%LOCALAPPDATA%\Backdrop\backdrop.log`. It records every startup, whether the
desktop layer was found, and any scene errors.

**"Backdrop is already running."**
It is in the notification area. Expand the overflow arrow.

**The scene shows in a window but not on the desktop, or it covers my icons.**
Run the diagnostic — it prints exactly which desktop windows Explorer is handing out
on your machine and which one Backdrop picked:

```powershell
.\dist\Backdrop.exe --diagnose
```

The report is also on **Copy diagnostics** in the tray menu, and it goes into the log
either way. Paste it and the cause is usually obvious in one line. The two common ones
are another wallpaper tool already holding the layer (close Wallpaper Engine, Lively,
or Rainmeter and retry), and `Chosen layer : None`, which means Explorer is not
running normally.

**The wallpaper goes black after changing resolution or unplugging a monitor.**
Backdrop re-attaches within about four seconds. If not, **Reload scene** from the tray.

**It came back to my old wallpaper after a reboot.**
Expected unless you did step 7 — nothing is installed, it is just a running process.

**It is eating GPU.**
Lower `render.targetFps` to 20 and `render.renderScale` to 0.6 in `config.json`, or
launch with `--fps 20 --scale 0.6` to try values before committing them.

**"dotnet is not recognized" / NU1101 package errors.**
Step 2, and confirm you can reach nuget.org.

**Everything is one flat colour.**
The GPU fell back to software rendering. `--devtools`, then check the console for a
shader link error and paste it in — that is the one failure the log cannot explain
on its own.
