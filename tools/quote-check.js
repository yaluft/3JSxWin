// quote-check.js — dev-only: find U+2018/U+2019/U+201C/U+201D smart quotes that
// sit in CODE (not full-line comments). Smart quotes as string delimiters parse
// in Node 24 but throw SyntaxError in Chromium/WebView2, so they must be ASCII.
// Usage: node tools/quote-check.js          (report only)
//        node tools/quote-check.js --fix    (normalize all smart quotes to ASCII)
const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..', 'src', 'Backdrop', 'web');
const fix = process.argv.includes('--fix');
const smart = /[\u2018\u2019\u201C\u201D]/;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|css)$/.test(e.name)) files.push(p);
  }
})(webRoot);

let issues = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!smart.test(src)) continue;
  const lines = src.split('\n');
  const bad = [];
  lines.forEach((l, i) => {
    if (smart.test(l) && !/^\s*\/\//.test(l)) bad.push(i + 1);
  });
  if (bad.length) {
    issues++;
    console.log((fix ? 'FIXED' : 'SMART QUOTES IN CODE'), path.relative(webRoot, f), 'lines:', bad.slice(0, 12).join(','), bad.length > 12 ? `(+${bad.length - 12} more)` : '');
    if (fix) {
      const out = src
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');
      fs.writeFileSync(f, out);
    }
  } else if (fix && smart.test(src)) {
    // smart quotes only in comments — harmless, normalize anyway for consistency
    fs.writeFileSync(f, src.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'));
  }
}
console.log(issues === 0 ? 'CLEAN' : `${issues} file(s) ${fix ? 'normalized' : 'need fixing'}`);
