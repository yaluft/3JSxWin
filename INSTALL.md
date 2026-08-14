# Install

Roughly ten minutes, most of it waiting on the SDK download.

## 0. What you need

| | |
| --- | --- |
| Windows 11 | Windows 10 20H1+ also works. |
| WebView2 Runtime | **Already installed on Windows 11.** Check: Settings → Apps → Installed apps → "Microsoft Edge WebView2 Runtime". If missing, get the Evergreen Standalone Installer from Microsoft. |
| .NET 8 SDK | https://dotnet.microsoft.com/download/dotnet/8.0 — the **SDK**, x64, not just the runtime. |

Visual Studio is not required. If you already have it with the **.NET desktop
development** workload, opening `Win11Backdrop.sln` works too.

## 1. Unzip

Put it somewhere without spaces or OneDrive sync:

```
C:\dev\Win11Backdrop
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
cd C:\dev\Win11Backdrop
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
your GPU is fine, before anything touches your desktop. Close it when satisfied.

## 5. Put it on the desktop

```powershell
.\dist\Backdrop.exe
```

The window disappears and the scene takes over your wallpaper, behind your icons. A
small aurora icon appears in the notification area — that is how you get back to it:

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

`dist\web\config.json` → edit → **Reload scene** from the tray. Start with:

```jsonc
"aurora":  { "intensity": 0.95, "speed": 0.055, "height": 0.5 },
"horizon": { "y": 0.36, "glow": 0.85, "reflection": 0.32 }
```

Push `horizon.y` up to `0.5` for a wider sky, or `intensity` to `1.4` for something
much louder. Editing `src\Backdrop\web\config.json` instead makes the change survive
the next build.

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
