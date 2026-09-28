# Credits

## Built with Claude

Backdrop was designed and written in collaboration with **[Claude](https://claude.ai)**
by [Anthropic](https://anthropic.com) — specifically Claude Opus 4.6, working from the
Microsoft Learn documentation tools for the WebView2 and Win32 surface area.

Claude wrote the initial implementation, then found and fixed four real bugs in it
during review:

| Bug | Why it mattered |
| --- | --- |
| `GetParent` used to verify `SetParent` | Returns the *owner*, not the parent, for a `WS_POPUP` window. A working attach reported as failed. |
| `SetParent` return value checked for null | Null is the previous parent of a top-level window — success and failure look identical. |
| `SWP_NOZORDER` after re-parenting | `SetParent` inserts at the *top* of the sibling z-order, putting the scene over the desktop icons. |
| `$args` in `build.ps1` | A PowerShell automatic variable, unavailable inside `[CmdletBinding()]`. Splatting it silently misfired. |

Commits made in that collaboration carry a trailer, which is the convention Anthropic
publishes for attributing AI-assisted work:

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```

`git-push.ps1` adds it for you. If you want a commit to be yours alone, pass
`-NoClaudeTrailer`.

## Third party

- **[Tone.js](https://tonejs.github.io)** ([Tonejs/Tone.js](https://github.com/Tonejs/Tone.js))
  15.1.22 — MIT. Vendored as a tree-shaken ESM bundle in `src/Backdrop/web/vendor/Tone.js`
  so the wallpaper's interstellar bed (drones, wind, sparse phrases) stays fully offline.

- **[three.js](https://threejs.org)** ([mrdoob/three.js](https://github.com/mrdoob/three.js))
  r185 — MIT. Vendored in `src/Backdrop/web/vendor/` rather than pulled from a CDN, so the
  scene works with no network at all. The scene's shader-quad, points field, and additive
  blending follow the patterns in the official examples:
  - [webgl_shaders_ocean](https://threejs.org/examples/#webgl_shaders_ocean) — full-screen shader surface
  - [webgl_points_sprites](https://threejs.org/examples/#webgl_points_sprites) — GPU-animated point field (the motes)
  - [webgl_buffergeometry_custom_attributes_particles](https://threejs.org/examples/#webgl_buffergeometry_custom_attributes_particles) — per-particle size/phase attributes
  - The complete gallery: <https://threejs.org/examples/>
- **[Microsoft.Web.WebView2](https://learn.microsoft.com/microsoft-edge/webview2/)** —
  the Chromium host. Pulled from NuGet at build time.

- **[NASA](https://nasa.gov)** ([Astronomy Picture of the Day archive](https://apod.nasa.gov/apod/archivepix.html))
  — reference imagery for the optional space themes. NASA media is generally not
  copyrighted and may be reused for any purpose; see NASA's
  [media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).
  Individual frames may carry a photographer or instrument-team credit, noted per image
  below.

  Nothing in `assets/images/` ships in the app. Each picture is a *visual reference* only:
  a theme's fragment shader is hand-written to reproduce the structure of the image —
  its geometry, palette and motion — so the scene stays a procedural WebGL shader with no
  texture to load and no image redistributed. Themes derived this way live under
  `src/Backdrop/web/themes/<id>/` and are opt-in per user from the Library card in
  Settings.

  Reference images in [`assets/images/`](assets/images):
  - `lions_head_nebula.jpg` — a JWST planetary nebula (pink inner shell, blue outer
    halo, radial spokes) — drives the **Lion's Head** theme.
  - `EclipsePair.jpg` — a total solar eclipse paired with an eclipsed Moon. The
    reference is a two-panel diptych; the theme deliberately fuses it into one
    composition with the two bodies facing each other — drives the **Eclipse Pair**
    theme.
  - `55369225127_dc150b5db0_o.jpg` — a JWST NIRCam star-forming region dominated by one
    six-spike hero star — drives the **Spike Hero** theme.
  - `55377597821_c2549169e9_o.png` — a wide edge-on starburst galaxy (icy dust lanes,
    magenta core, salmon filament loops) — drives the **Cold Lens** theme.
  - `jwst-cosmic-cliffs.jpg` — NASA SVS print of Webb NIRCam *Cosmic Cliffs* in
    NGC 3324 (Carina). Image: NASA, ESA, CSA, STScI — drives **Cosmic Cliffs**.
  - `jwst-pillars.jpg` — Webb NIRCam *Pillars of Creation* in M16. Image: NASA,
    ESA, CSA, STScI — drives **Pillars of Creation**.
  - `jwst-southern-ring.png` — Webb NIRCam *Southern Ring Nebula* (NGC 3132).
    Image: NASA, ESA, CSA, STScI — drives **Southern Ring**.
  - A NASA *Artist's Concept* of a young object launching a jet (tilted salmon
    dust disk, white-hot core, rust filaments, a dark near-side dust bank and a thin
    cyan bipolar jet). Image: NASA — drives **Jet Disk**. The reference was shared
    in-session and is not redistributed; `docs/themes/jetdisk.png` is a render of
    the shader, not the source image.

## Prior art

The `WorkerW` re-parenting technique is folklore that predates all of us. Wallpaper
Engine, [Lively Wallpaper](https://github.com/rocksdanister/lively), and a long tail of
blog posts arrived at the same `0x052C` message independently. Backdrop's contribution
is documenting *why* each step is needed, in `Interop/DesktopLayer.cs`.
