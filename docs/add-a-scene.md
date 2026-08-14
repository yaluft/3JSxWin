# Add a scene

Use this when you want a new wallpaper theme. Keep the change to one scene (or one soundscape) per PR.

## Shader scene

1. Add the id, label, and blurb to `src/Backdrop/web/js/scenes-meta.js`.
2. Write a fragment in `src/Backdrop/web/js/scenes.js` using the shared `COMMON` uniforms (`uVoid`, `uTide`, `uVerdant`, `uIris`, `uFrost`, `uTime`, `uIntensity`, `uSpeed`).
3. Register it on the `FRAGMENTS` map.
4. If motes should not overlay it, add the id to `silentScenes` in `src/Backdrop/web/js/main.js`.
5. Optional soundscape: add a builder in `src/Backdrop/web/js/audio.js` and wire it in `buildFor`.
6. Bump the `?v=` query on the `scenes.js` import in `main.js`.
7. Sync the site copy: `site/sync-scene.ps1`.
8. Test `.\dist\Backdrop.exe --window` and `?scene=<id>` in a browser.

## ASCII scene

Same as above, but:

1. Use `ASCII_GBUFFER` and `asciiLit(diff, spec, fog, rim)` instead of `COMMON`.
2. Add defaults in `ascii.js` (`ASCII_DEFAULTS`) and in both `config.json` copies.
3. Add console sliders in `src/Backdrop/web/js/panel.js`.

## Soundscape only

Add a `buildX()` graph in `audio.js` (oscillators and filtered noise, no files) and call it from `buildFor` for the existing scene id.

## Performance

Wallpapers run for hours. Stay on one full-screen quad, keep loops small, and treat 24 fps / 0.65 scale as the target.
