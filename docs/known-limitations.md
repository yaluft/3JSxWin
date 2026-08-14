# What does not work fully yet

Honest list of gaps. File an issue against one of these rather than assuming it is done.

## Overlay and toast

- HTML and sibling 2D canvases sit **under** WebView2’s DComp swap chain. The switch toast is drawn in the WebGL pass so it can show; if the context is lost or the scene is not a shader quad, the name may not appear.
- `Win+P` is also Windows **Project** (display topology). Palette shuffle and the OS projector UI can fire together.

## Multi-monitor

- Default **Duplicate** only applies when there are two or more displays and nothing on the CLI / saved layout overrides it.
- Saved `Single` in `%LOCALAPPDATA%\Backdrop\layout.txt` wins over the dual-screen default.
- Span-all is one canvas; per-monitor different scenes is not implemented.

## Optional themes (`web/themes/`)

- `theme.js` is **not** loaded until the id is in `config.installed`. A public `?scene=bayline` with an empty installed list falls back to Aurora.
- After editing a theme file, bump the `?v=` on the dynamic import in `theme-catalog.js` or the WebView will keep the old module.
- Bayline “3D” is isometric voxel faces on a fullscreen quad, not a mesh.
- Orbis / Ringfall / Nimbus are ray-hit spheres, not a quadtree LOD planet engine.
- Atoll / Shoal / Caldera are shader landscapes, not three.js `Water` / `Sky` / GLTF.
- Foldwell, Mothwork, Lungclock, and Sporehall were removed after they were uninstalled.

## Audio

- No audio files. Graphs are oscillators and filtered noise only.
- White / high-passed noise hissed; current graphs are low sine pads plus brown wash. They will not sound like recorded city or ocean beds.
- Chromium needs a gesture (or the wallpaper host’s first input) before `AudioContext` starts.

## Palettes

- **Environment** follows the current scene. **Custom** and named Neovim palettes do **not** change on scene switch.
- `build.ps1` overwrites `dist\web\config.json` from `src`. Live console saves in `dist` can disappear on the next publish.

## Host / teardown

- Chromium can log `UnregisterClass` / Win32 **1412** while a previous instance dies. That is teardown, not a failed start.
- Leftover `msedgewebview2` processes after a hard kill are possible. Reap or reboot if the next launch attaches to a dead view.
- C# host hardening (WebView dispose order, mutex hold) is still in progress on `main` and is **not** part of the themes contribution branch.

## Site and install

- [yakupov.xyz/scene](https://yakupov.xyz/scene/) is a browser preview. Library themes still need `installed` in that preview’s `config.json`.
- The one-line installer zip can lag this repo. Source build is the current tree.

## Not in scope

- Pulse (anime.js 2D test) is gone.
- No marketplace, no remote theme URLs, no user-pasted GLSL.
