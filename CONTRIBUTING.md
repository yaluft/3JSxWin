# Contributing

Backdrop is a small enough codebase to read in an afternoon and a wide enough one to
learn from: Win32 window management, WPF hosting, a Chromium embed, and GLSL. This
document is written for a team using it to learn, not for drive-by patches.

## Set up

```powershell
git clone <your-fork-url>
cd 3JSxWin
.\build.ps1
.\dist\Backdrop.exe --window     # always test here first
```

You need the **.NET 8 SDK** (x64). Visual Studio is optional; VS Code with the C# Dev
Kit works, and so does a bare terminal.

## The one rule

**`--window` before the desktop.** Every change gets tested in windowed mode first. A
bug in desktop mode can leave you with no visible desktop and no obvious way back, and
`--window` is a two-second check that rules out most of them.

If you do get stuck with an invisible backdrop: the tray icon is still there, and
`taskkill /IM Backdrop.exe` always works.

## Where things live

| Layer | Path | What you need to know to touch it |
| --- | --- | --- |
| Scene | `src/Backdrop/web/js/` | JavaScript and GLSL. No build step — edit, then **Reload scene** from the tray. |
| Config | `src/Backdrop/web/config.json` | Pure data. The safest thing to change. |
| Host window | `src/Backdrop/MainWindow.xaml.cs` | WPF + WebView2 lifecycle. |
| Win32 | `src/Backdrop/Interop/` | P/Invoke. Read the comments before editing — several lines look redundant and are not. |
| Tray | `src/Backdrop/Tray/TrayMenu.cs` | WinForms `NotifyIcon`. |
| CLI | `src/Backdrop/Startup/CommandLineOptions.cs` | Flags and the `Usage` text. Keep the two in step. |
| Site | `site/` | The Cloudflare Worker behind yakupov.xyz. `site/sync-scene.ps1` copies the scene into `site/public/scene/`. |

Inside `web/js/`, the frequently-edited files are:

| File | What is in it |
| --- | --- |
| `main.js` | Boot, the render loop, the adaptive quality ladder, scene switching, per-scene tuning. |
| `scenes.js` | The core fragment shaders, and the `FRAGMENTS` map that names them. |
| `scenes-meta.js` | Core scene ids, labels, and blurbs, plus the active-list helpers the catalog calls. |
| `theme-catalog.js` | The optional `web/themes/` library: what is installed, and lazy-loading a theme's shader on first show. |
| `shader-lib.js` | GLSL shared between core scenes and themes. |
| `sky.js` | The aurora scene proper: curtains, stars, horizon, reflection. |
| `ascii.js` | The glyph atlas and the shared ASCII pass. |
| `audio.js` | Generated soundscapes. Oscillators and filtered noise, no audio files. |
| `palettes.js` | The twelve Neovim palettes. |
| `panel.js` | The `Ctrl+Alt+B` console: control list, layout, theme install toggles, save/reset. |

ES module imports carry a `?v=` query — bump it when you change a file, or WebView2 will serve the cached copy.

`Interop/NativeMethods.cs` is deliberately dumb: raw P/Invoke, no logic. Decisions live
in `DesktopLayer.cs`, `MonitorLayout.cs`, and `ForegroundWatcher.cs`. Keep it that way —
it makes the interop layer auditable at a glance.

**Add a wallpaper.** Follow [docs/add-a-scene.md](docs/add-a-scene.md). Open an enhancement issue first if the idea is larger than one scene.

## A learning path

Roughly increasing difficulty. Each one is a real improvement, not busywork.

**1 — Change the sky.** Edit `web/config.json`. Push `aurora.intensity` to `1.6`, move
`horizon.y` to `0.5`, swap `palette.iris` for something warm. No compiler involved.
*Learn: how the scene is parameterised.*

**2 — Add a config key.** Add `stars.size`, thread it through `config.js` → `sky.js` as
a uniform, and use it in the fragment shader. *Learn: the config → uniform pipeline.*

**3 — Add a CLI flag.** Add `--pause` to `Startup/CommandLineOptions.cs` and have it
post a `visibility` message to the page. *Learn: host → page messaging over
`PostWebMessageAsJson`.*

**4 — Add a tray item.** "Next preset", cycling through several `config-*.json` files.
*Learn: WinForms interop inside a WPF app.*

**5 — Make the HUD useful.** `hud.enabled: true`, then add weather or CPU load. *Learn:
where a wallpaper should and should not do work — see the frame governor first.*

**6 — Per-monitor scenes.** `--duplicate-all` already puts one window on each monitor,
but all of them read the same config. Giving each display its own scene and palette is
a real feature. *Learn: `MonitorLayout` and the WorkerW coordinate space.*

**7 — Survive a GPU driver reset.** `webglcontextlost` is handled; a full device removal
is not. *Learn: WebView2 process lifetime.*

## Writing the change

- **One concern per PR.** A shader tweak and a P/Invoke fix are two PRs.
- **Comment the non-obvious, not the obvious.** `// increment i` helps nobody.
  `// GetParent returns the OWNER for a WS_POPUP window` saves the next person a day.
  Look at `DesktopLayer.Attach` for the standard being aimed at.
- **No new dependencies** without discussing it first. Two is a feature.
- **Log at decision points.** A wallpaper has no window to complain in.
  `%LOCALAPPDATA%\Backdrop\backdrop.log` is the only channel.

## Testing

There is no test suite yet — adding one is a genuinely welcome PR. Until then, the
manual pass before you open one:

- [ ] `.\build.ps1` is clean, 0 warnings
- [ ] `--window` renders
- [ ] Desktop mode attaches (log says `Attached to WorkerW`, or `Progman` as a fallback)
- [ ] Icons still clickable, taskbar still on top
- [ ] Win+`]` walks every scene without a black frame or a console error
- [ ] `--diagnose` runs
- [ ] Tray: reload, mode toggle, layout, quit
- [ ] Explorer restart (`taskkill /f /im explorer.exe & explorer.exe`) — it re-attaches

CI runs markdownlint over every `*.md` and builds `src/Backdrop/Backdrop.csproj` with
`--warnaserror`, so a warning is a red check.

## Commits

Present tense, imperative, explaining *why*:

```text
Verify SetParent with GetAncestor instead of GetParent

GetParent returns the owner, not the parent, for a window still
carrying WS_POPUP, so a successful attach reported as a failure and
the app dropped into its windowed fallback.
```

If Claude helped, keep the trailer — see [CREDITS.md](CREDITS.md). `git-push.ps1` adds
it automatically.

## Review

Two questions, in order:

1. Does it work on a machine that is not the author's? Multi-monitor, mixed DPI, and
   integrated graphics are where this project breaks.
2. Will the next person understand *why*, six months from now, without asking?

Approve on both. Push back on either.
