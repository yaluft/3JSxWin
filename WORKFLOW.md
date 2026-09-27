# WORKFLOW.md — the session task graph

Every task in this repo session is written the way [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
writes workflows: a **node graph**. Each task is a node with typed inputs/outputs, edges are
data/control dependencies, and the `R` edges are **repetition loops** — the cycles ComfyUI
would show as a wire fed back into an earlier node (execute → inspect → repeat per item).

Legend: `[N]` node id · `▸` control flow · `┈▸` repetition/loop-back edge · `◆` gate (must pass
before the next stage fires).

```
                                ┌────────────────────────────┐
                                │ 0  AuditSource             │
                                │ in : repo files            │
                                │ out: facts{hotkey, panel,  │
                                │      audio, themes, root}  │
                                └───────────┬────────────────┘
                                            │ facts
                 ┌──────────────────────────┼──────────────────────────────┐
                 ▼                          ▼                              ▼
  ┌─────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────────────┐
  │ 1 CopilotOverride       │  │ 2 DevToolsHotkey          │  │ 3 HandpanAudio           │
  │ in : facts.hotkey       │  │ in : facts.hotkey         │  │ in : facts.audio         │
  │ ops: Hotkey.cs          │  │ ops: Hotkey.cs            │  │ ops: audio.js            │
  │     SceneHost wiring    │  │     MainWindow force-open │  │     (SomaFM stream → out)│
  │ out: chords{Win+C,      │  │     TrayMenu hint         │  │ out: engine{hum,strike} │
  │     Win+F23} swallowed  │  │ out: chord{Win+Shift+U}  │  └────────────┬─────────────┘
  └───────────┬─────────────┘  └────────────┬──────────────┘               │ engine
              │ chords                      │ chord                        │
              │              ┌──────────────┴───────────────┐              │
              │              ▼                              ▼              │
              │   ┌───────────────────────────┐  ┌─────────────────────────┴──┐
              │   │ 4 SettingsBackend         │  │ 5 ThemeRefine (R ×5)       │
              │   │ in : facts.panel,host     │  │ in : facts.themes, engine  │
              │   │ ops: SceneHost.cs         │  │ for t in [farfield,        │
              │   │     MainWindow.cs         │  │   globule, night-field,    │
              │   │  - scene→host live sync   │  │   solarsystem, starnode]:  │
              │   │  - factory reset path     │  │   refine GLSL (keep id)    │
              │   │  - force DevTools toggle  │  │   buildAudio → handpan     │
              │   │ out: hostbus{live,save}   │  │   ┈▸ next t                │
              │   └────────────┬──────────────┘  └────────────┬───────────────┘
              │                │ hostbus                       │ themes'
              ▼                ▼                               ▼
  ┌────────────────────────────────────────┐       ┌────────────────────────────┐
  │ 6 SettingsUI                           │◄──────┤ out: refined themes        │
  │ in : hostbus, facts.panel              │       └────────────────────────────┘
  │ ops: panel.js, style.css, console.html │
  │  - space-glass visual language         │
  │  - collapsible fine-tune cards         │
  │  - Library card w/ blurbs + live sync  │
  │ out: ui{panel v5, css v9}              │
  └───────────────────┬────────────────────┘
                      │ ui + chords + engine + themes'
                      ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 7 RootSweep                                                │
  │ in : facts.root (every home-folder file read)              │
  │ ops: git rm install-startup.ps1 · git rm tune-scene.ps1    │
  │     git mv show-configs.ps1 tools/ · README/HANDOFF edits  │
  │ out: tidy repo (report-only: copilot.vim/, dist/,          │
  │       win11backdrop-update/, Jekyll leftovers)             │
  └───────────────────┬────────────────────────────────────────┘
                      ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 8 BuildVerify (R until green)                              │
  │ ops: dotnet build · node --check ×(changed js)             │
  │      GLSL brace check (tools/glsl-check.js)                │
  │      live browser render of the settings panel             │
  │      ┌── fail → fix → ┈▸ re-run                            │
  │ ◆ ok ┴─▶ 9 Installer                                      │
  └────────────────┬───────────────────────────────────────────┘
                   ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 9 Installer                                                │
  │ ops: installer.ps1 · csproj version metadata               │
  │  - publish source → %LOCALAPPDATA%\Programs\Win11Backdrop  │
  │    (deepest standard per-user path, no admin)              │
  │  - Start-menu + Startup shortcuts, ARP entry, uninstaller  │
  │ ◆ verified: process path, shortcuts, registry, scene ready │
  └────────────────┬───────────────────────────────────────────┘
                   ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 10 CommsFix (user report: "chat window isn't working")     │
  │ diagnosis: log shows 5 open/close bursts; the documented   │
  │   AllowsTransparency airspace bug — keyboard focus never   │
  │   crossed into the WebView2 child, typing went nowhere     │
  │ ops: CommsWindow.xaml/.cs (opaque window, focus forwarding │
  │   on Activated, SWP_FRAMECHANGED after ex-style rewrite),  │
  │   comms.css solid shell, comms.html/comms.js note refresh  │
  │ ◆ verified: dotnet build green; endpoint alive (401 anon)  │
  └────────────────┬───────────────────────────────────────────┘
                   ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 11 WebbThemes (R ×2) — "NASA 2026 JWST. AMAZE me!!"        │
  │  i=0 webbmirror : hex-bokeh stars + 6 diffraction spikes, │
  │                   golden galaxy deep field, honeycomb      │
  │                   whisper — the mirror's fingerprint       │
  │  i=1 lensfield  : REAL gravitational lensing — background  │
  │                   sampled through thetaE²/r deflection,    │
  │                   galaxies bent into Einstein arcs         │
  │ ops: themes/webbmirror + themes/lensfield, index.json ×2   │
  │ ◆ verified: node --check, GLSL balance, live WebGL render  │
  │   of both scenes in-browser (screenshots in session log)   │
  └────────────────────────┬───────────────────────────────────┘
                           ▼
  ┌────────────────────────────────────────────────────────────┐
  │ 12 ImageReplicas (R ×3) — "replicate these image per image" │
  │  i=0 nircam    : NIRCam deep field — ONE frame-spanning    │
  │                   golden 6-spike hero + companions, blue-  │
  │                   violet dusty nebula, rust slab, gold     │
  │                   galaxy backdrop                          │
  │  i=1 starburst : M82 Cigar Galaxy — diagonal beaded violet │
  │                   disk, superwind plumes, rose arcs,       │
  │                   6-spike foreground stars                 │
  │  i=2 saucer    : edge-on spiral — thin ring-gap lavender   │
  │                   disk, cream nucleus, dust fringe, teal   │
  │                   clusters, 4-spike anchor star            │
  │ ops: themes/{nircam,starburst,saucer}, index.json ×3       │
  │ R2 "gas clouds faintly and such": re-analysis showed the   │
  │   sources are veiled in frame-wide faint gas, not clean    │
  │   void - added gasVeil+extinction (nircam), wider plumes   │
  │   + gasWash (starburst), cirrus+wisps (saucer)             │
  │ R3 re-analysis + naming: Flickr pages identified the true  │
  │   originals - labels renamed FS Tau / Centaurus A /        │
  │   Sombrero (M104); gas gains raised again (veils now       │
  │   clearly visible at a glance, vision-rated 6-7/10)        │
  │ R4 "horrible": R3's gains read as uniform FOG - flattened  │
  │   contrast, drowned subjects. Reshaped all gas to DISCRETE │
  │   clumps (hard smoothstep window + squared mask, dark gaps │
  │   between clouds) and re-darkened backgrounds; vision      │
  │   re-verified: crisp, punchy subjects, clumped gas         │
  │ ◆ verified: real-WebGL compile probe CLEAN ×3, live        │
  │   renders vision-checked per source image (8-8.5/10), gas  │
  │   veils confirmed visible at 60-80% frame coverage         │
  └────────────────────────────────────────────────────────────┘
```
## Node status

| # | Node | Output artifact | State |
|---|------|-----------------|-------|
| 0 | AuditSource | facts (this session's file audit) | ☑ done |
| 1 | CopilotOverride | `Hotkey.cs` swallows Win+C **and** the hardware Copilot chord (Win[+Ctrl][+Shift]+F23) → Comms | ☑ |
| 2 | DevToolsHotkey | secret `Win+Shift+U` → force-opens DevTools even without `--devtools` | ☑ |
| 3 | HandpanAudio | `audio.js` rebuilt: hum bed + struck handpan notes, no internet radio | ☑ |
| 4 | SettingsBackend | `SceneHost.cs`/`MainWindow.cs`: scene→host config sync, factory reset, force DevTools | ☑ |
| 5 | ThemeRefine ×5 | each `themes/*/theme.js` refined (identity kept) + handpan `buildAudio` | ☑ |
| 6 | SettingsUI | `panel.js` + `style.css` + `console.html`: space-glass, collapsible, decluttered | ☑ |
| 7 | RootSweep | root folder triaged; redundant scripts removed/moved; docs updated | ☑ |
| 8 | BuildVerify | `dotnet build` green + `node --check` green + browser-verified panel | ☑ |
| 9 | Installer | `installer.ps1` → deep per-user install, verified running from the new path | ☑ |
| 10 | CommsFix | opaque CommsWindow + focus forwarding — typing/drag restored | ☑ |
| 11 | WebbThemes ×2 | `webbmirror` + `lensfield` in the Library, WebGL-verified | ☑ |
| 12 | ImageReplicas ×3 | `nircam` + `starburst` + `saucer` — one per source image, vision-verified | ☑ |

## The repetition cycles in detail

ComfyUI repeats a node once per batch item; these are the loops this session runs:

1. **ThemeRefine** — 5 iterations (one per theme folder). Each iteration refines the GLSL
   *in place* (no id/label/blurb changes, nothing deleted) and rewrites `buildAudio` onto
   the handpan API. Wire: `engine ─▶ ThemeRefine[i] ─┈▸ ThemeRefine[i+1]`.
2. **BuildVerify** — repeats until green: any compile/syntax failure feeds the offending
   node back a fix, then re-runs. Gate `◆` passes only on a clean `dotnet build` and
   clean `node --check` over every changed module.
3. **LiveSync** (runtime, not session) — the new permanent loop: scene mutation →
   `tellHost({type:'live'})` → SceneHost persists to config.json + broadcasts to every
   monitor → `applyLive`. Palette shuffles (Win+P) now survive a reload with zero UI.
4. **ImageReplicas** — 3 iterations (one per source image): analyze image → write theme →
   compile-probe in a real WebGL context → live render → vision-check vs the source →
   gain/layout fix → re-render. Wire: `analyze[i] ─▶ write[i] ─▶ render[i] ─┈fix▸ render[i]`.
