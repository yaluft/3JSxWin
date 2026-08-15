---
layout: default
title: Configure
nav_order: 3
---

# Configure {: .no_toc }

Every scene setting lives in a single JSON file. Most changes need no restart.
{: .fs-6 .fw-300 }

## Table of contents {: .no_toc .text-delta }

1. TOC
{:toc}

---

## The config file

There are two copies of `config.json`:

| Path | Purpose |
| --- | --- |
| `src\Backdrop\web\config.json` | Source copy — changes here survive the next build. |
| `dist\web\config.json` | Live copy — what the running app reads. Edit this for quick testing. |

After editing the live copy, use **Reload scene** from the tray.

---

## Live console

Press `Ctrl+Alt+B` to open the floating on-screen console. It has sliders and colour pickers for the sections below, and changes preview live. **SAVE** writes them to `config.json`; **RESET** goes back to the last save. Closing without saving discards everything.

A few controls — mote count and the HUD clock among them — only take effect on a scene reload. SAVE performs that reload once.

---

## scene

Which scene loads at startup, by id.

```jsonc
"scene": "aurora"
```

| id | Name | id | Name |
| --- | --- | --- | --- |
| `aurora` | Aurora | `bloom` | Bloom |
| `terrascii` | Tube Dunes | `petrichor` | Petrichor |
| `hexascii` | ASCII Tubes | `kelp` | Kelp |
| `starwell` | Starwell | `murmur` | Murmur |
| `warpscii` | Tube Warp | `cicada` | Cicada |
| `ion` | Ion | `rime` | Rime |
| `wave` | Kanagawa | `pulse` | Pulse |
| `blobscii` | Tube Loops | | |
| `ember` | Ember | | |

Win+`]` and Win+`[` cycle through the list at runtime; the value here is only what loads first. (`--scene` on the command line is unrelated — it points the host at a different web folder.)

## paletteName

The colour theme applied over `palette`. `boreal` is the built-in default; the other twelve are ports of real Neovim themes.

```jsonc
"paletteName": "boreal"
```

`boreal`, `catppuccin-mocha`, `tokyonight`, `rose-pine`, `kanagawa`, `gruvbox`, `nord`, `everforest`, `dracula`, `onedark`, `oxocarbon`, `carbonfox`, `solarized-osaka`.

Win+`P` shuffles to a random one. Anything other than `boreal` overwrites the five `palette` colours below when the scene loads.

## palette

The five colours every scene is built from. Each is a CSS hex colour.

```jsonc
"palette": {
  "void":    "#04060c",  // Deepest background, the top of the sky.
  "tide":    "#0b2233",  // Mid background, near the horizon.
  "verdant": "#35e3a0",  // The green-teal end of the aurora.
  "iris":    "#6e5bff",  // The violet end of the aurora.
  "frost":   "#cfe9ff"   // Highlights, stars, and ASCII ink.
}
```

## aurora

The northern-lights curtains.

```jsonc
"aurora": {
  "intensity": 1.6,   // Overall brightness. 0.9 is calm, 2.0 is loud.
  "speed":     0.16,  // How fast the curtains drift. Lower is calmer.
  "height":    0.95   // How far up the screen the curtains reach.
}
```

## horizon

The horizon line and the aurora reflected below it.

```jsonc
"horizon": {
  "y":          0.30,  // Where the line sits. 0 = bottom of screen, 1 = top.
  "glow":       1.2,   // Brightness of the glow band along the line.
  "reflection": 0.65   // Strength of the reflection. 0 turns it off entirely.
}
```

Raising `y` lifts the horizon, which means less sky and more reflected water.

## stars

```jsonc
"stars": {
  "density": 1.0,  // How many pixels light up above the horizon.
  "twinkle": 0.9   // How hard they flicker. 0 holds them steady.
}
```

## motes

The drifting particle field in front of the sky.

```jsonc
"motes": {
  "count":   360,       // Number of particles. Requires a reload to change.
  "color":   "#cfe9ff", // Particle colour.
  "size":    2.8,       // Base size in pixels, jittered per particle.
  "drift":   0.45,      // Drift speed.
  "opacity": 0.55       // Peak opacity of a particle.
}
```

{: .note }
`motes.count` takes effect only after a scene reload, and the ASCII, Kanagawa, Pulse, and nature scenes never draw motes regardless of the value.

## finish

The post pass applied over every scene.

```jsonc
"finish": {
  "grain":    0.03,  // Film grain. Also dithers the gradient, so leave a little in.
  "vignette": 0.35   // Corner darkening.
}
```

## ascii

Per-scene grid settings for the four density-ASCII scenes. Column count follows window width, clamped between `minCols` and `maxCols`.

```jsonc
"ascii": {
  "terrascii": { "cellPx": 6, "minCols": 80, "maxCols": 480 },
  "hexascii":  { "cellPx": 6, "minCols": 80, "maxCols": 480 },
  "warpscii":  { "cellPx": 6, "minCols": 80, "maxCols": 480 },
  "blobscii":  { "cellPx": 6, "minCols": 80, "maxCols": 480 }
}
```

Raising `cellPx` makes bigger glyphs and a coarser grid — and is much cheaper than lowering it.

## render

Performance settings.

```jsonc
"render": {
  "targetFps":       24,          // Frame cap. A wallpaper rarely needs more.
  "renderScale":     0.65,        // Resolution multiplier, before the cap below.
  "octaves":         3,           // Noise detail in the shader. 2 is cheap, 4 is rich.
  "adaptiveQuality": true,        // Step scale and octaves down if frames are being missed.
  "powerPreference": "low-power", // WebGL hint: "low-power" or "high-performance".
  "antialias":       false        // Ignored — see below.
}
```

Rendered pixels are capped at roughly 1.8M regardless of `renderScale`, so a 4K display does not quietly cost four times a 1080p one.

With `adaptiveQuality` on, the scene walks down a fixed ladder (`0.85/4` → `0.7/3` → `0.55/3` → `0.45/2`) whenever it misses its frame budget for four seconds, and logs each step to the DevTools console. Set it to `false` to pin the quality you chose.

`antialias` is present in the file but the renderer always runs without it — a full-screen shader quad gains nothing from MSAA.

## hud

Optional clock overlay.

```jsonc
"hud": {
  "enabled":  false,          // Set true to show it.
  "corner":   "bottom-right", // "top-left", "top-right", "bottom-left", "bottom-right".
  "clock24h": true,           // false gives a 12-hour clock.
  "locale":   "en-CA"         // Any BCP 47 tag; drives date and time formatting.
}
```

## audio

Five scenes — Petrichor, Kelp, Murmur, Cicada, and Rime — generate their own soundscape from oscillators and filtered noise. No audio files are shipped.

```jsonc
"audio": {
  "volume": 0.2  // 0 silences them.
}
```

Audio is disabled outright when the scene is embedded in an iframe, so the preview on the site stays quiet.

---

## Command-line overrides

Render settings can be overridden per launch without touching the file:

```powershell
.\dist\Backdrop.exe --fps 30 --scale 0.75
```

`--fps` is clamped to 1–144 and `--scale` to 0.4–1.0. Both take priority over `config.json` and neither is persisted. `.\dist\Backdrop.exe --help` prints the full flag list.
