// panel.js — the settings panel UI. Builds the whole "console" DOM (Fluent-style cards of
// sliders, toggles, colour pickers) from one CONTROLS table, and reports every edit back to
// the caller. It lives in web/js because both the in-scene overlay and the standalone
// ConsoleWindow load it — see console-main.js, which wires this to the C# host.
//
// This module only builds the DOM and reports intent; it does not decide how changes are
// applied. The caller passes callbacks:
//   onChange(draft, control)  — a control moved; draft holds the full edited config.
//   onCommand(name, payload)  — a button/close fired: 'save' | 'reset' | 'shuffle' | 'close' | 'host'.
// That keeps it usable both in-page (apply straight to the live scene) and in a separate
// console window (forward every change to the host, which relays to the scene). In the
// ConsoleWindow case each callback becomes a chrome.webview.postMessage up to C#
// (ConsoleWindow.WebMessageReceived -> SceneHost), which is why this file never imports
// anything from the WPF side and never touches config.json itself.

import { PALETTES } from './palettes.js';
import { CORE_IDS, SCENE_IDS, SCENE_META, visibleSceneIds } from './scenes-meta.js';
import { getCatalog } from './theme-catalog.js';

// HOST_ACTIONS — buttons that ask the C# host to do something the page physically can't:
// reload the WebView2, open a File Explorer window, pop DevTools, tail the log file, quit
// the process. Each id is posted up verbatim as onCommand('host', { action: id }) and
// SceneHost switches on it. Kept as data (not hard-coded buttons) so the grid at the bottom
// of CONTROLS is just `{ type: 'actions', buttons: HOST_ACTIONS }`.
const HOST_ACTIONS = [
  { id: 'reload', label: 'Reload scene' },
  { id: 'folder', label: 'Open scene folder' },
  { id: 'devtools', label: 'Open DevTools' },
  { id: 'log', label: 'Open log' },
  { id: 'diagnose', label: 'Copy diagnostics' },
  { id: 'quit', label: 'Quit' },
  { id: 'kill', label: 'Kill process' },
];

// CONTROLS — the single declarative table the whole panel is generated from. Read top to
// bottom by createPanel(): a `{ section: 'X' }` row starts a new card, every other row is
// one control. Cards are ordered by how often they’re touched: Scene / Audio / Clock /
// This theme up top, everything else folded away (collapsed: true renders the card as a
// <details> that starts shut) so the panel opens clean instead of as a wall of sliders.
// The shape of a control row tells buildRow() what widget to make:
//   min/max/step        -> range slider (the default; no `type` needed)
//   type: 'color'       -> <input type=color>
//   type: 'toggle'      -> checkbox (add `hint` for a caption under the label)
//   type: 'select'      -> <select> over `options`
//   type: 'note'        -> a paragraph of explanatory text, no input
//   type: 'command'     -> a full-width row that fires onCommand('host', {action})
//   type: 'actions'     -> a grid of plain buttons (the System card’s host block)
// `group` + `key` say where in the config object the value lives — 'root' is a top-level
// key, 'tune' is the per-scene override bag (draft.scenes[currentScene]), 'installed' is
// the theme-library array, and a dotted string like 'ascii.terrascii' is a nested object.
// `reload: true` marks a change that the scene can’t apply live (it needs a fresh page),
// so Save forwards a reload hint and the row gets a visual marker.
const CONTROLS = [
  { section: 'Scene' },
  {
    group: 'root', key: 'scene', label: 'Backdrop', type: 'select', reload: true,
    options: visibleSceneIds,
  },
  {
    group: 'root', key: 'paletteName', label: 'Palette', type: 'select',
    options: ['boreal', 'custom', ...PALETTES.map((p) => p.id)],
  },

  { section: 'Audio' },
  { group: 'audio', key: 'enabled', label: 'Sound', type: 'toggle', hint: 'Tone.js space bed — drones, wind, sparse interstellar phrases' },
  { group: 'audio', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },

  { section: 'Clock' },
  { group: 'hud', key: 'enabled', label: 'Show', type: 'toggle', reload: true },
  {
    group: 'hud', key: 'corner', label: 'Corner', type: 'select', reload: true,
    options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  },

  // Per-scene overrides for whatever world is currently selected (draft.scenes[scene]).
  // The labels map onto different uniforms per theme — every theme module reads
  // intensity/speed/height, and volume is that scene’s slice of the audio bed.
  { section: 'This theme' },
  { group: 'tune', key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  { group: 'tune', key: 'speed', label: 'Speed', min: 0, max: 0.3, step: 0.001 },
  { group: 'tune', key: 'height', label: 'Height', min: 0.05, max: 1.2, step: 0.01 },
  { group: 'tune', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },
  { group: 'tune', key: 'geeked', label: 'Max mode', type: 'toggle', hint: 'The theme’s extra overlay layer, if it ships one' },

  // ---- fine-tune: folded by default ------------------------------------
  // Aurora / Horizon / Sky are shader-uniform knobs for the Aurora scene: each
  // slider’s value flows straight into a `uniform float` the fragment shader
  // reads every frame, so dragging one is visible immediately.
  { section: 'Aurora', collapsed: true },
  { group: 'aurora', key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  { group: 'aurora', key: 'speed', label: 'Speed', min: 0, max: 0.3, step: 0.001 },
  { group: 'aurora', key: 'height', label: 'Height', min: 0.05, max: 1.2, step: 0.01 },

  { section: 'Horizon', collapsed: true },
  { group: 'horizon', key: 'y', label: 'Line', min: 0, max: 0.8, step: 0.01 },
  { group: 'horizon', key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01 },
  { group: 'horizon', key: 'reflection', label: 'Reflection', min: 0, max: 1, step: 0.01 },

  { section: 'Sky', collapsed: true },
  { group: 'stars', key: 'density', label: 'Stars', min: 0, max: 2, step: 0.01 },
  { group: 'stars', key: 'twinkle', label: 'Twinkle', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'grain', label: 'Grain', min: 0, max: 0.1, step: 0.001 },

  // Motes are the drifting dust particles (a three.js Points cloud, not a shader effect).
  // drift/opacity/colour restyle the existing points live; `count` rebuilds the
  // BufferGeometry, so it’s reload-flagged rather than applied on the fly.
  { section: 'Motes', collapsed: true },
  { group: 'motes', key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.01 },
  { group: 'motes', key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { group: 'motes', key: 'color', label: 'Colour', type: 'color' },
  { group: 'motes', key: 'count', label: 'Count', min: 0, max: 2000, step: 50, reload: true },

  // The five raw colour slots. Picking any of these flips the palette to "custom".
  { section: 'Palette colours', collapsed: true },
  { group: 'palette', key: 'verdant', label: 'Aurora lo', type: 'color' },
  { group: 'palette', key: 'iris', label: 'Aurora hi', type: 'color' },
  { group: 'palette', key: 'frost', label: 'Highlight', type: 'color' },
  { group: 'palette', key: 'tide', label: 'Sky base', type: 'color' },
  { group: 'palette', key: 'void', label: 'Sky deep', type: 'color' },

  // ASCII scenes render the G-buffer as a grid of glyphs. cellPx is the glyph
  // cell size in pixels; minCols/maxCols clamp how many columns we draw so the
  // grid stays legible on both a laptop panel and a 4K span. Grouped under
  // 'ascii.<sceneId>' so each scene keeps its own tuning.
  { section: 'ASCII · Dunes', collapsed: true },
  { group: 'ascii.terrascii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.terrascii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.terrascii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Warp', collapsed: true },
  { group: 'ascii.warpscii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.warpscii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.warpscii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Loops', collapsed: true },
  { group: 'ascii.blobscii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.blobscii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.blobscii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Glyphfall', collapsed: true },
  { group: 'ascii.glyphfall', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.glyphfall', key: 'minCols', label: 'Min chars', min: 16, max: 640, step: 2 },
  { group: 'ascii.glyphfall', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  // ---- system: the app around the scene ---------------------------------
  { section: 'System' },
  { type: 'note', text: 'Windows has no API for a fourth Background type. 3JSxWin attaches to the desktop WorkerW layer instead, and registers the hooks a Win32 app is actually allowed to use.' },
  { type: 'command', action: 'desktop', label: 'Set as desktop background', hint: 'Attach behind icons via WorkerW' },
  { type: 'command', action: 'window', label: 'Show in a window', hint: 'Pull the scene off the desktop' },
  { type: 'command', action: 'layout-single', label: 'This monitor', hint: 'Cover the primary display only' },
  { type: 'command', action: 'layout-span', label: 'Span all monitors', hint: 'One continuous scene' },
  { type: 'command', action: 'layout-duplicate', label: 'Duplicate on all monitors', hint: 'One copy per display' },
  { type: 'command', action: 'startup-on', label: 'Start with Windows', hint: 'Startup-folder shortcut' },
  { type: 'command', action: 'startup-off', label: 'Don’t start with Windows' },
  { type: 'command', action: 'windows-settings', label: 'Windows background settings', hint: 'ms-settings:personalization-background' },
  { type: 'command', action: 'screensaver-on', label: 'Use as screensaver', hint: 'Registers this exe; not a picker list item' },
  { type: 'command', action: 'register-shell', label: 'Register Windows hooks', hint: 'Desktop menu, protocol, theme, screensaver' },
  { type: 'actions', buttons: HOST_ACTIONS },
];

export function createPanel(config, { onChange, onCommand } = {}) {
  const draft = structuredClone(config);
  draft.installed = [...(draft.installed ?? [])];
  let dirty = false;
  let needsReload = false;

  const root = document.createElement('aside');
  root.className = 'console';
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="console__bar" data-drag>
      <span class="console__dot"></span>
      <span class="console__name">Settings</span>
      <button class="console__x" data-act="close" type="button" title="Esc">×</button>
    </div>
    <div class="console__body"></div>
    <div class="console__ref">3JSxWin · live wallpaper</div>
    <div class="console__foot">
      <span class="console__stat" data-stat>Ready</span>
      <span class="console__actions">
        <button class="console__btn" data-act="shuffle" type="button">Shuffle</button>
        <button class="console__btn" data-act="randomize" type="button" title="Re-roll stars, glow and planets (not the palette or scene)">Randomize</button>
        <button class="console__btn" data-act="reset" type="button">Reset</button>
        <button class="console__btn console__btn--go" data-act="save" type="button">Save</button>
      </span>
    </div>`;

  const body = root.querySelector('.console__body');
  const stat = root.querySelector('[data-stat]');
  const setStat = (t) => { stat.textContent = t; };

  let card = null;
  // startCard builds one settings card. Collapsed cards render as <details> that
  // start shut — the fine-tune knobs are one click away but don't flood the
  // panel on open. Open cards are a plain <section> with an <h2>.
  function startCard(title, collapsed = false) {
    const wrap = document.createElement(collapsed ? 'details' : 'section');
    wrap.className = 'console__card' + (collapsed ? ' console__card--fold' : '');
    const h = document.createElement(collapsed ? 'summary' : 'h2');
    h.className = 'console__group';
    h.textContent = title;
    wrap.appendChild(h);
    body.appendChild(wrap);
    card = wrap;
    return wrap;
  }
  function host() {
    return card ?? body;
  }

  for (const c of CONTROLS) {
    if (c.section) {
      startCard(c.section, c.collapsed === true);
      continue;
    }
    host().appendChild(buildRow(c));
  }

  // The Library card: one toggle per optional world in the catalog. Flipping a
  // toggle applies LIVE to the wallpaper (the change rides the normal 'live'
  // path); Save is what commits it to config.json. The blurb under each label is
  // the catalog's one-liner, so the card doubles as the discovery surface.
  startCard('Library');
  const libNote = document.createElement('p');
  libNote.className = 'console__note';
  libNote.textContent = 'Optional worlds. Toggles sync with the wallpaper live; Save commits them to config.json.';
  card.appendChild(libNote);
  for (const theme of getCatalog()) {
    card.appendChild(buildRow({
      group: 'installed', key: theme.id, label: theme.label ?? theme.id, type: 'toggle',
      hint: theme.blurb,
    }));
  }
  const sceneSel = root.querySelector('select[data-key="scene"]');
  if (sceneSel) syncSceneOptions(sceneSel, draft);

  function buildRow(c) {
    if (c.type === 'note') {
      const note = document.createElement('p');
      note.className = 'console__note';
      note.textContent = c.text;
      return note;
    }

    if (c.type === 'command') {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'console__command';
      const text = document.createElement('span');
      text.className = 'console__command-text';
      const name = document.createElement('span');
      name.className = 'console__label';
      name.textContent = c.label;
      text.appendChild(name);
      if (c.hint) {
        const hint = document.createElement('span');
        hint.className = 'console__hint';
        hint.textContent = c.hint;
        text.appendChild(hint);
      }
      const chev = document.createElement('span');
      chev.className = 'console__chevron';
      chev.textContent = '›';
      row.append(text, chev);
      row.addEventListener('click', () => onCommand?.('host', { action: c.action }));
      return row;
    }

    if (c.type === 'actions') {
      const wrap = document.createElement('div');
      wrap.className = 'console__hostgrid';
      for (const item of c.buttons) {
        const id = typeof item === 'string' ? item : item.id;
        const label = typeof item === 'string' ? item : item.label;
        const btn = el('button', { type: 'button', class: 'console__btn', 'data-host': id });
        btn.textContent = label;
        btn.addEventListener('click', () => onCommand?.('host', { action: id }));
        wrap.appendChild(btn);
      }
      return wrap;
    }

    const row = document.createElement('label');
    row.className = 'console__row' + (c.reload ? ' console__row--reload' : '');

    // Label column. With a `hint` it becomes a two-line box (name + caption) —
    // used by the Library toggles and Max mode so rows stay self-explanatory.
    const name = document.createElement('span');
    name.className = 'console__label';
    name.textContent = c.label;
    if (c.hint) {
      const box = document.createElement('span');
      box.className = 'console__labelbox';
      box.appendChild(name);
      const hint = document.createElement('span');
      hint.className = 'console__hint';
      hint.textContent = c.hint;
      box.appendChild(hint);
      row.appendChild(box);
    } else {
      row.appendChild(name);
    }

    const current = readValue(draft, c);

    if (c.type === 'color') {
      const input = el('input', { type: 'color', value: current ?? '#ffffff' });
      input.addEventListener('input', () => set(c, input.value));
      row.appendChild(input);
    } else if (c.type === 'toggle') {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!current;
      input.addEventListener('change', () => set(c, input.checked));
      row.classList.add('console__row--toggle');
      row.appendChild(input);
    } else if (c.type === 'select') {
      const sel = document.createElement('select');
      if (c.key) sel.dataset.key = c.key;
      // options may be a live array or a function (so it can be filtered at
      // render time — the scene list hides the preset ids).
      const opts = typeof c.options === 'function' ? c.options() : c.options;
      for (const opt of opts) {
        const o = el('option', { value: opt });
        o.textContent = optionLabel(opt);
        if (opt === current) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => set(c, sel.value));
      row.appendChild(sel);
    } else {
      const val = el('output', {});
      val.className = 'console__value';
      val.textContent = fmt(current);

      const input = el('input', {
        type: 'range', min: c.min, max: c.max, step: c.step,
        value: current ?? c.min,
      });
      input.addEventListener('input', () => {
        const n = Number(input.value);
        val.textContent = fmt(n);
        set(c, n);
      });
      const wrap = document.createElement('span');
      wrap.className = 'console__slider';
      wrap.append(input, val);
      row.appendChild(wrap);
    }
    return row;
  }

  function set(c, value) {
    writeValue(draft, c, value);
    dirty = true;
    if (c.reload) needsReload = true;
    if (c.group === 'palette') {
      draft.paletteName = 'custom';
      draft.customPalette = { ...draft.palette };
      const sel = root.querySelector('select[data-key="paletteName"]');
      if (sel) sel.value = 'custom';
    }
    if (c.group === 'installed') {
      const sel = root.querySelector('select[data-key="scene"]');
      if (sel) syncSceneOptions(sel, draft);
      if (!draft.installed.includes(draft.scene) && !CORE_IDS.includes(draft.scene)) {
        draft.scene = 'aurora';
        if (sel) sel.value = 'aurora';
      }
    }
    if (c.key === 'paletteName') {
      if (value === 'custom') {
        if (draft.customPalette) draft.palette = { ...draft.palette, ...draft.customPalette };
      } else {
        const named = PALETTES.find((p) => p.id === value);
        if (named) {
          draft.palette = { ...draft.palette, ...named.palette };
          if (draft.motes) draft.motes.color = named.palette.frost;
        }
      }
    }
    setStat('Unsaved');
    onChange?.(draft, c);
  }

  root.querySelector('[data-act="save"]').addEventListener('click', () => {
    if (!dirty) { setStat('Nothing to save'); return; }
    onCommand?.('save', { config: draft, reload: needsReload });
    dirty = false;
    setStat(needsReload ? 'Saved · reloading' : 'Saved');
  });
  root.querySelector('[data-act="randomize"]').addEventListener('click', () => {
    onCommand?.('randomize');
    setStat('Randomized stars, glow and planets');
  });

  root.querySelector('[data-act="shuffle"]').addEventListener('click', () => {
    onCommand?.('shuffle');
    setStat('Shuffled palette');
  });
  root.querySelector('[data-act="reset"]').addEventListener('click', () => {
    onCommand?.('reset');
    setStat('Reset from backup');
  });
  root.querySelector('[data-act="close"]').addEventListener('click', () => onCommand?.('close'));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCommand?.('close'); }
  });

  makeDraggable(root, root.querySelector('[data-drag]'));
  document.body.appendChild(root);

  return {
    root,
    focus() { root.focus?.(); },
    setStat,
  };
}

// Drag by the title bar, clamped so it can't be lost off-screen.
function makeDraggable(node, handle) {
  let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    const rect = node.getBoundingClientRect();
    baseX = rect.left; baseY = rect.top; startX = e.clientX; startY = e.clientY;
    node.style.right = 'auto'; node.style.bottom = 'auto';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = node.offsetWidth, h = node.offsetHeight;
    node.style.left = `${clamp(baseX + (e.clientX - startX), 0, window.innerWidth - w)}px`;
    node.style.top = `${clamp(baseY + (e.clientY - startY), 0, window.innerHeight - h)}px`;
  });
  handle.addEventListener('pointerup', (e) => {
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
  });
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** 'ascii.terrascii' -> draft.ascii?.terrascii. A plain 'motes' still reads draft.motes. */
function getGroup(draft, path) {
  return path.split('.').reduce((node, key) => node?.[key], draft);
}

/** Same dotted path, but creates any missing intermediate objects along the way. */
function ensureGroup(draft, path) {
  return path.split('.').reduce((node, key) => (node[key] ??= {}), draft);
}

function tuneGroup(draft) {
  return draft.scenes?.[draft.scene];
}

function ensureTuneGroup(draft) {
  (draft.scenes ??= {})[draft.scene] ??= {};
  return draft.scenes[draft.scene];
}

function readValue(draft, c) {
  if (c.group === 'root') return draft[c.key];
  if (c.group === 'tune') return tuneGroup(draft)?.[c.key];
  if (c.group === 'installed') return (draft.installed ?? []).includes(c.key);
  return getGroup(draft, c.group)?.[c.key];
}

function writeValue(draft, c, value) {
  if (c.group === 'root') draft[c.key] = value;
  else if (c.group === 'tune') ensureTuneGroup(draft)[c.key] = value;
  else if (c.group === 'installed') {
    const set = new Set(draft.installed ?? []);
    if (value) set.add(c.key);
    else set.delete(c.key);
    draft.installed = [...set];
  } else ensureGroup(draft, c.group)[c.key] = value;
}

function syncSceneOptions(sel, draft) {
  const allow = new Set(getCatalog().map((t) => t.id));
  const ids = [...CORE_IDS, ...(draft.installed ?? []).filter((id) => allow.has(id) && !CORE_IDS.includes(id))];
  const current = draft.scene;
  sel.replaceChildren();
  for (const opt of ids) {
    const o = el('option', { value: opt });
    o.textContent = optionLabel(opt);
    if (opt === current) o.selected = true;
    sel.appendChild(o);
  }
}

function optionLabel(opt) {
  if (opt === 'custom') return 'Custom';
  return SCENE_META[opt]?.label ?? PALETTES.find((p) => p.id === opt)?.label ?? opt;
}

function el(tag, attrs) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function fmt(n) {
  if (typeof n !== 'number') return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
}
