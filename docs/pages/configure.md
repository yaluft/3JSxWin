---
layout: default
title: Configure
nav_order: 3
---

# Configure {: .no_toc }

All scene settings live in a single JSON file. No restart needed for most changes.
{: .fs-6 .fw-300 }

## Table of contents {: .no_toc .text-delta }

1. TOC
{:toc}

---

## The config file

There are two copies of `config.json`:

| Path | Purpose |
|------|---------|
| `src\Backdrop\web\config.json` | Source copy — changes here survive the next build. |
| `dist\web\config.json` | Live copy — what the running app reads. Edit this for quick testing. |

After editing the live copy, use **Reload scene** from the tray (or press `Ctrl+Alt+R` if the on-screen console is open).

---

## Live console

Press `Ctrl+Alt+B` to open the floating on-screen console. It has sliders and colour pickers for every section below. Changes preview live. Click **SAVE** to write them to `config.json`. Click **RESET** to restore the last save.

---

## aurora

Controls the northern-lights effect.

```jsonc
"aurora": {
  "intensity": 0.95,   // Overall brightness. 0.5 = subtle, 1.4 = dramatic.
  "speed":     0.055,  // Animation speed. Lower = calmer.
  "height":    0.5     // How high the aurora rises on screen. 0 = low, 1 = full height.
}
```

## horizon

Controls the horizon line and water-reflection effect.

```jsonc
"horizon": {
  "y":          0.36,  // Vertical position of the horizon (0 = bottom, 1 = top).
  "glow":       0.85,  // Brightness of the horizon glow band.
  "reflection": 0.32   // Intensity of the reflected aurora in the "water".
}
```

## sky

Background gradient colours.

```jsonc
"sky": {
  "topColor":    "#050a1a",  // Zenith colour.
  "midColor":    "#0a1a30",  // Mid-sky colour.
  "bottomColor": "#0d1f3c"   // Near-horizon sky colour.
}
```

## palette

Aurora colour palette. Each is a CSS hex colour.

```jsonc
"palette": {
  "iris":    "#7b4fa6",  // Violet hue.
  "teal":    "#00c8a0",  // Green-teal hue.
  "frostHi": "#e8f4f8",  // Bright highlight.
  "frostLo": "#a8c8d8"   // Soft highlight.
}
```

## motes

The floating particle field.

```jsonc
"motes": {
  "count":     3500,    // Number of particles. Requires a reload to change.
  "size":      1.8,     // Base particle size in pixels.
  "speed":     0.0004,  // Drift speed.
  "opacity":   0.55     // Maximum opacity of each particle.
}
```

{: .note }
`motes.count` takes effect only after a scene reload.

## render

Performance settings.

```jsonc
"render": {
  "targetFps":   60,   // Frame rate cap. Lower to reduce GPU load.
  "renderScale": 1.0   // Resolution multiplier. 0.6 is a good balance on low-end GPUs.
}
```

## hud

Optional heads-up display overlay.

```jsonc
"hud": {
  "enabled": false,  // Set to true to enable.
  "opacity": 0.7
}
```

## Command-line overrides

You can override render settings without editing the file:

```powershell
.\dist\Backdrop.exe --fps 30 --scale 0.75
```

These take priority over `config.json` but are not persisted.
