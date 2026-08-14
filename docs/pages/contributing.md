---
layout: default
title: Contributing
nav_order: 4
---

# Contributing
{: .no_toc }

Backdrop is small enough to read in an afternoon and broad enough to learn from: Win32, WPF, WebView2, and GLSL all in one codebase.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Set up

```powershell
git clone <your-fork-url>
cd Win11Backdrop
.\build.ps1
.\dist\Backdrop.exe --window     # always test here first
```

You need the **.NET 8 SDK** (x64). Visual Studio is optional; VS Code with the C# Dev Kit works, and so does a bare terminal.

---

## The one rule

**`--window` before the desktop.** Every change gets tested in windowed mode first. A bug in desktop mode can leave you with no visible desktop and no obvious way back, and `--window` is a two-second check that rules out most of them.

If you do get stuck with an invisible backdrop: the tray icon is still there, and `taskkill /IM Backdrop.exe` always works.

---

## Where things live

| Layer | Path | What you need to know |
|-------|------|-----------------------|
| Scene | `src/Backdrop/web/js/` | JavaScript and GLSL. No build step — edit, then **Reload scene** from the tray. |
| Config | `src/Backdrop/web/config.json` | Pure data. The safest thing to change. |
| Host window | `src/Backdrop/MainWindow.xaml.cs` | WPF + WebView2 lifecycle. |
| Win32 | `src/Backdrop/Interop/` | P/Invoke. Read the comments before editing. |
| Tray | `src/Backdrop/Tray/TrayMenu.cs` | WinForms `NotifyIcon`. |

`Interop/NativeMethods.cs` is deliberately dumb: raw P/Invoke, no logic. Keep it that way — it makes the interop layer auditable at a glance.

---

## Learning path

Roughly increasing difficulty. Each one is a real improvement.

1. **Change the sky** — Edit `web/config.json`. Push `aurora.intensity` to `1.6`, move `horizon.y` to `0.5`. No compiler involved. *Learn: how the scene is parameterised.*

2. **Add a config key** — Add `stars.size`, thread it through `config.js` → `sky.js` as a uniform. *Learn: the config → uniform pipeline.*

3. **Add a CLI flag** — Add `--pause` to `Startup/CommandLineOptions.cs` and post a message to the page. *Learn: host → page messaging over `PostWebMessageAsJson`.*

4. **Add a tray item** — "Next preset", cycling through `config-*.json` files. *Learn: WinForms interop inside a WPF app.*

5. **Make the HUD useful** — `hud.enabled: true`, then add weather or CPU load. *Learn: where a wallpaper should and should not do work.*

6. **Multi-monitor per-screen scenes** — Today `--span-all` stretches one scene. One window per monitor, each with its own config, is a real feature. *Learn: `MonitorLayout` and the WorkerW coordinate space.*

7. **Survive a GPU driver reset** — `webglcontextlost` is handled; a full device removal is not. *Learn: WebView2 process lifetime.*

---

## Writing the change

- **One concern per PR.** A shader tweak and a P/Invoke fix are two PRs.
- **Comment the non-obvious, not the obvious.** `// GetParent returns the OWNER for a WS_POPUP window` saves the next person a day.
- **No new dependencies** without discussing it first.
- **Log at decision points.** A wallpaper has no window to complain in; `%LOCALAPPDATA%\Backdrop\backdrop.log` is the only channel.

---

## Manual test checklist

Before opening a PR, run through:

- [ ] `.\build.ps1` is clean, 0 warnings
- [ ] `--window` renders
- [ ] Desktop mode attaches (log says `Attached to WorkerW`)
- [ ] Icons still clickable, taskbar still on top
- [ ] `--diagnose` runs
- [ ] Tray: reload, mode toggle, quit
- [ ] Explorer restart re-attaches the scene

---

## Commits

Present tense, imperative, explaining *why*:

```
Verify SetParent with GetAncestor instead of GetParent

GetParent returns the owner, not the parent, for a window still
carrying WS_POPUP, so a successful attach reported as a failure.
```

If Claude helped, keep the `Co-authored-by` trailer — see [Credits]({% link docs/pages/credits.md %}). `git-push.ps1` adds it automatically.
