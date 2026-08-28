// Settings panel — Fluent-style cards over the same live-config console.
//
// This module only builds the DOM and reports intent; it does not decide how changes are
// applied. The caller passes callbacks:
//   onChange(draft, control)  — a control moved; draft holds the full edited config.
//   onCommand(name, payload)  — a button/close fired: 'save' | 'reset' | 'close'.
// That keeps it usable both in-page (apply straight to the live scene) and in a separate
// console window (forward every change to the host, which relays to the scene).

import { PALETTES } from './palettes.js';
import { CORE_IDS, SCENE_IDS, SCENE_META } from './scenes-meta.js';
import { getCatalog } from './theme-catalog.js';

const HOST_ACTIONS = [
  { id: 'reload', label: 'Reload scene' },
  { id: 'folder', label: 'Open scene folder' },
  { id: 'devtools', label: 'Open DevTools' },
  { id: 'log', label: 'Open log' },
  { id: 'diagnose', label: 'Copy diagnostics' },
  { id: 'quit', label: 'Quit' },
  { id: 'kill', label: 'Kill process' },
];

const CONTROLS = [
  { section: 'Scene' },
  {
    group: 'root', key: 'scene', label: 'Backdrop', type: 'select', reload: true,
    options: SCENE_IDS,
  },
  {
    group: 'root', key: 'paletteName', label: 'Palette', type: 'select',
    options: ['boreal', 'custom', ...PALETTES.map((p) => p.id)],
  },

  { section: 'Aurora' },
  { group: 'aurora', key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  { group: 'aurora', key: 'speed', label: 'Speed', min: 0, max: 0.3, step: 0.001 },
  { group: 'aurora', key: 'height', label: 'Height', min: 0.05, max: 1.2, step: 0.01 },

  { section: 'Horizon' },
  { group: 'horizon', key: 'y', label: 'Line', min: 0, max: 0.8, step: 0.01 },
  { group: 'horizon', key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01 },
  { group: 'horizon', key: 'reflection', label: 'Reflection', min: 0, max: 1, step: 0.01 },

  { section: 'Sky' },
  { group: 'stars', key: 'density', label: 'Stars', min: 0, max: 2, step: 0.01 },
  { group: 'stars', key: 'twinkle', label: 'Twinkle', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'grain', label: 'Grain', min: 0, max: 0.1, step: 0.001 },

  { section: 'Motes' },
  { group: 'motes', key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.01 },
  { group: 'motes', key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { group: 'motes', key: 'color', label: 'Colour', type: 'color' },
  { group: 'motes', key: 'count', label: 'Count', min: 0, max: 2000, step: 50, reload: true },

  { section: 'ASCII · Dunes' },
  { group: 'ascii.terrascii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.terrascii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.terrascii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Warp' },
  { group: 'ascii.warpscii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.warpscii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.warpscii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Loops' },
  { group: 'ascii.blobscii', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.blobscii', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.blobscii', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'ASCII · Glyphfall' },
  { group: 'ascii.glyphfall', key: 'cellPx', label: 'Char size', min: 4, max: 28, step: 0.5 },
  { group: 'ascii.glyphfall', key: 'minCols', label: 'Min chars', min: 16, max: 320, step: 2 },
  { group: 'ascii.glyphfall', key: 'maxCols', label: 'Max chars', min: 16, max: 640, step: 2 },

  { section: 'Palette' },
  { group: 'palette', key: 'verdant', label: 'Aurora lo', type: 'color' },
  { group: 'palette', key: 'iris', label: 'Aurora hi', type: 'color' },
  { group: 'palette', key: 'frost', label: 'Highlight', type: 'color' },
  { group: 'palette', key: 'tide', label: 'Sky base', type: 'color' },
  { group: 'palette', key: 'void', label: 'Sky deep', type: 'color' },

  { section: 'Clock' },
  { group: 'hud', key: 'enabled', label: 'Show', type: 'toggle', reload: true },
  {
    group: 'hud', key: 'corner', label: 'Corner', type: 'select', reload: true,
    options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  },

  { section: 'Audio' },
  { group: 'audio', key: 'enabled', label: 'Sound', type: 'toggle' },
  { group: 'audio', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },

  { section: 'This theme' },
  { group: 'tune', key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  { group: 'tune', key: 'speed', label: 'Speed', min: 0, max: 0.3, step: 0.001 },
  { group: 'tune', key: 'height', label: 'Height', min: 0.05, max: 1.2, step: 0.01 },
  { group: 'tune', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },
  { group: 'tune', key: 'geeked', label: 'Geeked', type: 'toggle' },

  { section: 'Personalization' },
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

  { section: 'Host' },
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
        <button class="console__btn" data-act="reset" type="button">Reset</button>
        <button class="console__btn console__btn--go" data-act="save" type="button">Save</button>
      </span>
    </div>`;

  const body = root.querySelector('.console__body');
  const stat = root.querySelector('[data-stat]');
  const setStat = (t) => { stat.textContent = t; };

  let card = null;
  function startCard(title) {
    const wrap = document.createElement('section');
    wrap.className = 'console__card';
    const h = document.createElement('h2');
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
      startCard(c.section);
      continue;
    }
    host().appendChild(buildRow(c));
  }

  startCard('Library');
  for (const theme of getCatalog()) {
    card.appendChild(buildRow({
      group: 'installed', key: theme.id, label: theme.label ?? theme.id, type: 'toggle',
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

    const name = document.createElement('span');
    name.className = 'console__label';
    name.textContent = c.label;
    row.appendChild(name);

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
      for (const opt of c.options) {
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
