# Add a scene

Keep one scene (or one soundscape) per PR.

## Core shader (always loaded)

1. Add the id to `CORE_IDS` and metadata in `src/Backdrop/web/js/scenes-meta.js`.
2. Write a fragment in `src/Backdrop/web/js/scenes.js` using `COMMON` from `shader-lib.js`.
3. Register it on the `FRAGMENTS` map.
4. Optional soundscape: add a builder in `audio.js` and wire it in `buildFor`.
5. Bump the `?v=` query on the `scenes.js` import in `main.js`.
6. Test `.\dist\Backdrop.exe --window` and `?scene=<id>` in a browser.

## Optional theme (installed from the library)

Files ship under `src/Backdrop/web/themes/` but `theme.js` is not imported until the user toggles the theme on in the console **library** section (`config.installed`).

1. Add `{ id, label, blurb, family }` to `src/Backdrop/web/themes/index.json`.
2. Create `src/Backdrop/web/themes/<id>/theme.js` exporting:
   - `id`, `meta` (`label`, `blurb`, `silent`)
   - `kind: 'shader'`
   - `fragment` — unique `main()` only; the host prepends `COMMON`
   - optional `buildAudio(api)` using `osc` / `noise` / `filter` / `gain` / `lfo` / `startTracked` / `everyRandom` (no files)
3. Do **not** add the id to `CORE_IDS` or statically import the module.
4. Test by installing it in the console, then `?scene=<id>` after it is in `installed`.

## ASCII scene (core only)

1. Use `ASCII_GBUFFER` and `asciiLit(diff, spec, fog, rim)` instead of `COMMON`.
2. Add defaults in `ascii.js` (`ASCII_DEFAULTS`) and in `config.json`.
3. Add console sliders in `src/Backdrop/web/js/panel.js`.

## Performance

Wallpapers run for hours. Stay on one full-screen quad, keep loops small, and treat 24 fps / 0.65 scale as the target.
