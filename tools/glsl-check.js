// glsl-check.js — dev-only: brace/paren balance sanity for theme fragments.
// Usage: node tools/glsl-check.js  (from repo root)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'Backdrop', 'web', 'themes');
const themes = fs.readdirSync(root).filter((d) =>
  fs.existsSync(path.join(root, d, 'theme.js')));

let fail = 0;
for (const t of themes) {
  const f = path.join(root, t, 'theme.js');
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/export const fragment = \/\* glsl \*\/ `([\s\S]*?)`;\n/);
  if (!m) { console.log('NO FRAGMENT', t); fail = 1; continue; }
  const g = m[1];
  // strip comments so braces inside them don't count
  const clean = g.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const c = (s, ch) => s.split(ch).length - 1;
  const b = c(clean, '{'), rb = c(clean, '}');
  const p = c(clean, '('), rp = c(clean, ')');
  const main = /void main\s*\(\s*\)\s*\{/.test(clean);
  const ok = b === rb && p === rp && main;
  console.log(ok ? 'OK  ' : 'FAIL', t.padEnd(12), 'braces', b + '/' + rb, 'parens', p + '/' + rp, 'main()', main);
  if (!ok) fail = 1;
}
process.exit(fail);
