// The control console UI — a floating, draggable, translucent terminal-style panel.
//
// This module only builds the DOM and reports intent; it does not decide how changes are
// applied. The caller passes callbacks:
//   onChange(draft, control)  — a control moved; draft holds the full edited config.
//   onCommand(name, payload)  — a button/close fired: 'save' | 'reset' | 'close'.
// That keeps it usable both in-page (apply straight to the live scene) and in a separate
// console window (forward every change to the host, which relays to the scene).

const CONTROLS = [
  { section: 'aurora' },
  { group: 'aurora', key: 'intensity', label: 'intensity', min: 0, max: 2, step: 0.01 },
  { group: 'aurora', key: 'speed', label: 'speed', min: 0, max: 0.3, step: 0.001 },
  { group: 'aurora', key: 'height', label: 'height', min: 0.05, max: 1.2, step: 0.01 },

  { section: 'horizon' },
  { group: 'horizon', key: 'y', label: 'line', min: 0, max: 0.8, step: 0.01 },
  { group: 'horizon', key: 'glow', label: 'glow', min: 0, max: 2, step: 0.01 },
  { group: 'horizon', key: 'reflection', label: 'reflection', min: 0, max: 1, step: 0.01 },

  { section: 'sky' },
  { group: 'stars', key: 'density', label: 'stars', min: 0, max: 2, step: 0.01 },
  { group: 'stars', key: 'twinkle', label: 'twinkle', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'vignette', label: 'vignette', min: 0, max: 1, step: 0.01 },
  { group: 'finish', key: 'grain', label: 'grain', min: 0, max: 0.1, step: 0.001 },

  { section: 'motes' },
  { group: 'motes', key: 'drift', label: 'drift', min: 0, max: 2, step: 0.01 },
  { group: 'motes', key: 'opacity', label: 'opacity', min: 0, max: 1, step: 0.01 },
  { group: 'motes', key: 'color', label: 'colour', type: 'color' },
  { group: 'motes', key: 'count', label: 'count', min: 0, max: 2000, step: 50, reload: true },

  { section: 'palette' },
  { group: 'palette', key: 'verdant', label: 'aurora.lo', type: 'color' },
  { group: 'palette', key: 'iris', label: 'aurora.hi', type: 'color' },
  { group: 'palette', key: 'frost', label: 'highlight', type: 'color' },
  { group: 'palette', key: 'tide', label: 'sky.base', type: 'color' },
  { group: 'palette', key: 'void', label: 'sky.deep', type: 'color' },

  { section: 'clock' },
  { group: 'hud', key: 'enabled', label: 'show', type: 'toggle', reload: true },
  {
    group: 'hud', key: 'corner', label: 'corner', type: 'select', reload: true,
    options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  },
];

export function createPanel(config, { onChange, onCommand } = {}) {
  const draft = structuredClone(config);
  let dirty = false;
  let needsReload = false;

  const root = document.createElement('aside');
  root.className = 'console';
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="console__bar" data-drag>
      <span class="console__dot"></span>
      <span class="console__name">backdrop.cfg</span>
      <button class="console__x" data-act="close" type="button" title="Esc">×</button>
    </div>
    <div class="console__body"></div>
    <div class="console__ref"># three.js examples · threejs.org/examples</div>
    <div class="console__foot">
      <span class="console__stat" data-stat>ready</span>
      <span class="console__actions">
        <button class="console__btn" data-act="reset" type="button">RESET</button>
        <button class="console__btn console__btn--go" data-act="save" type="button">SAVE</button>
      </span>
    </div>`;

  const body = root.querySelector('.console__body');
  const stat = root.querySelector('[data-stat]');
  const setStat = (t) => { stat.textContent = t; };

  for (const c of CONTROLS) {
    if (c.section) {
      const h = document.createElement('div');
      h.className = 'console__group';
      h.textContent = `> ${c.section}`;
      body.appendChild(h);
      continue;
    }
    body.appendChild(buildRow(c));
  }

  function buildRow(c) {
    const row = document.createElement('label');
    row.className = 'console__row' + (c.reload ? ' console__row--reload' : '');

    const name = document.createElement('span');
    name.className = 'console__label';
    name.textContent = c.label;
    row.appendChild(name);

    const current = draft[c.group]?.[c.key];

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
      for (const opt of c.options) {
        const o = el('option', { value: opt });
        o.textContent = opt;
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
    (draft[c.group] ??= {})[c.key] = value;
    dirty = true;
    if (c.reload) needsReload = true;
    setStat('* unsaved');
    onChange?.(draft, c);
  }

  root.querySelector('[data-act="save"]').addEventListener('click', () => {
    if (!dirty) { setStat('nothing to save'); return; }
    onCommand?.('save', { config: draft, reload: needsReload });
    dirty = false;
    setStat(needsReload ? 'saved · reloading' : 'saved');
  });
  root.querySelector('[data-act="reset"]').addEventListener('click', () => {
    onCommand?.('reset');
    setStat('reset from backup');
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

function el(tag, attrs) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function fmt(n) {
  if (typeof n !== 'number') return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
}
