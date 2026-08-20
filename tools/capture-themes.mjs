// Capture optional theme stills to docs/themes/<id>.png (1280x720).
// Serves src/Backdrop/web, sets config.installed for the session, restores the original file.
// Uses system Chrome over CDP — no npm install.
//
//   node tools/capture-themes.mjs
//   node tools/capture-themes.mjs deep-field

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'src', 'Backdrop', 'web');
const CONFIG = join(WEB, 'config.json');
const OUT = join(ROOT, 'docs', 'themes');
const DEFAULT_THEMES = [
  'mycelight', 'mothwork', 'coralnet', 'lungclock',
  'inkatrium', 'foldwell', 'sporehall', 'orreryheart', 'threadloom',
  'deep-field',
];
const THEMES = process.argv.slice(2).filter(Boolean);
const IDS = THEMES.length ? THEMES : DEFAULT_THEMES;
const VIEWPORT = { width: 1280, height: 720 };
const WAIT_MS = 4500;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
};

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && existsSync(p));
}

function serve(root) {
  return new Promise((ready, fail) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      if (rel === '/') rel = '/index.html';
      const file = resolve(root, `.${rel}`);
      const under = file.toLowerCase().startsWith(root.toLowerCase());
      if (!under || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ready(server));
  });
}

function setInstalled(ids) {
  const text = readFileSync(CONFIG, 'utf8');
  if (!/"installed"\s*:\s*\[[^\]]*\]/.test(text)) {
    throw new Error('config.json has no installed array');
  }
  writeFileSync(CONFIG, text.replace(/"installed"\s*:\s*\[[^\]]*\]/, `"installed": ${JSON.stringify(ids)}`));
  return text;
}

function launchChrome(exe) {
  const profile = mkdtempSync(join(tmpdir(), 'backdrop-theme-cap-'));
  const chrome = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  return { chrome, profile, wsUrl: waitDevtoolsUrl(chrome) };
}

function waitDevtoolsUrl(chrome) {
  return new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => {
      chrome.off('exit', onExit);
      reject(new Error('Chrome DevTools URL timeout'));
    }, 20000);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        chrome.off('exit', onExit);
        chrome.stderr.off('data', onData);
        chrome.stdout.off('data', onData);
        resolveUrl(match[1]);
      }
    };
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools ready (${code})\n${buf}`));
    };
    chrome.stderr.on('data', onData);
    chrome.stdout.on('data', onData);
    chrome.once('exit', onExit);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.events.has(msg.method)) {
        for (const fn of this.events.get(msg.method)) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => {
        const list = this.events.get(method);
        if (list) this.events.set(method, list.filter((x) => x !== fn));
        resolve(params);
      };
      const list = this.events.get(method) ?? [];
      list.push(fn);
      this.events.set(method, list);
    });
  }
}

async function connectPage(browserWs) {
  const browser = new Cdp(new WebSocket(browserWs));
  await new Promise((resolve, reject) => {
    browser.ws.addEventListener('open', resolve, { once: true });
    browser.ws.addEventListener('error', () => reject(new Error('browser websocket failed')), { once: true });
  });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    send(method, params = {}) {
      const id = ++browser.next;
      return new Promise((resolve, reject) => {
        browser.pending.set(id, { resolve, reject });
        browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    once(method) {
      return browser.once(method);
    },
  };
  return { browser, page };
}

async function capture(page, url, dest) {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await loaded;
  await page.send('Runtime.evaluate', {
    expression: `(() => {
      const style = document.createElement('style');
      style.textContent = '.dock, .overlay, .hud, .fallback { display: none !important; visibility: hidden !important; }';
      document.documentElement.appendChild(style);
    })()`,
  });
  const scene = await page.send('Runtime.evaluate', {
    expression: 'new URLSearchParams(location.search).get("scene")',
    returnByValue: true,
  });
  const got = scene.result?.value;
  if (got !== new URL(url).searchParams.get('scene')) {
    throw new Error(`scene mismatch: ${got}`);
  }
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const shot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(dest, Buffer.from(shot.data, 'base64'));
}

async function main() {
  const original = readFileSync(CONFIG, 'utf8');
  const exe = chromePath();
  if (!exe) throw new Error('Chrome not found; set CHROME to the browser executable');

  const server = await serve(WEB);
  const { port } = server.address();
  let launched;
  try {
    setInstalled(IDS);
    launched = launchChrome(exe);
    const wsUrl = await launched.wsUrl;
    const { browser, page } = await connectPage(wsUrl);
    try {
      for (const id of IDS) {
        const dest = join(OUT, `${id}.png`);
        await capture(page, `http://127.0.0.1:${port}/?scene=${id}`, dest);
        console.log(`wrote ${dest}`);
      }
    } finally {
      browser.ws.close();
    }
  } finally {
    writeFileSync(CONFIG, original);
    if (launched?.chrome && !launched.chrome.killed) {
      launched.chrome.kill();
      await new Promise((r) => launched.chrome.once('exit', r));
    }
    if (launched?.profile) {
      try { rmSync(launched.profile, { recursive: true, force: true }); } catch { /* ignore locked profile files */ }
    }
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
