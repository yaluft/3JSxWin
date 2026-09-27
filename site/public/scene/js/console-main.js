// console-main.js — entry point for the standalone console (settings) window. This page is
// NOT the scene: it loads console.html inside ConsoleWindow's own small always-on-top
// WebView2 and hosts only the control panel, so opening settings never moves or focuses
// the fullscreen backdrop parked on the WorkerW layer behind the desktop icons.
//
// The wiring here is deliberately thin. panel.js builds the whole UI and hands us intent
// through two callbacks; all we do is repackage that intent as a chrome.webview.postMessage
// up to ConsoleWindow (C#), which raises it to SceneHost. SceneHost is the one that relays
// live edits to the scene window and writes config.json to disk. This file never touches
// config.json and never talks to the scene directly — one seam, easy to reason about.

// loadConfig() resolves the full config (FALLBACK <- config.json <- URL query <- palette).
// createPanel() turns that config into the DOM. host.js is our only door to the C# side.
// theme-catalog fetches themes/index.json so the panel's Library card can list optional
// scenes. The ?v=N on panel.js is the cache-buster — WebView2 caches modules hard, so the
// integer is bumped whenever the file changes to force a fresh load (see config.js).
import { loadConfig } from './config.js';
import { createPanel } from './panel.js?v=7';
import { tellHost, reportError } from './host.js';
import { loadCatalog, setInstalled } from './theme-catalog.js';

// Kick off async boot immediately. A throw anywhere in boot() has no visible console on a
// tiny chromeless window, so funnel it through reportError, which also posts { type:'error' }
// up to C# to land in Backdrop's log file.
boot().catch((error) => reportError('console-boot', error));

async function boot() {
  // Resolve config first, then load the theme manifest, then tell the catalog which optional
  // themes the user has installed. Order matters: setInstalled() filters config.installed
  // against the catalog, so loadCatalog() has to have populated it first — otherwise every
  // installed id looks unknown and the Library card comes up empty.
  const config = await loadConfig();
  await loadCatalog();
  setInstalled(config.installed);

  // Build the panel DOM from the resolved config and give panel.js the two callbacks it
  // reports through. panel.js owns a private `draft` clone of the config and mutates that as
  // controls move; we only ever forward it, never edit it here.
  const panel = createPanel(config, {
    onChange(draft) {
      // Relay the whole edited config to the host each change; the scene applies it live.
      // We send the entire draft (not a diff) so SceneHost can just swap its config wholesale
      // — cheap, and it sidesteps any patch-merge bug on a live-preview path.
      tellHost({ type: 'live', config: draft });
    },
    onCommand(name, payload) {
      // Buttons and Esc land here. Each maps to one message type SceneHost switches on.
      // 'savecfg' carries the reload hint (some edits — scene swap, mote count, clock — can't
      // apply live and need a fresh page); the rest are bare verbs. 'host' actions (reload,
      // open folder, DevTools, quit...) are things the page physically can't do itself.
      if (name === 'save') tellHost({ type: 'savecfg', config: payload.config, reload: payload.reload });
      else if (name === 'reset') tellHost({ type: 'resetcfg' });
      else if (name === 'shuffle') tellHost({ type: 'shuffle' });
      else if (name === 'randomize') tellHost({ type: 'randomize' });
      else if (name === 'close') tellHost({ type: 'close' });
      else if (name === 'host') tellHost({ type: 'host', action: payload.action });
    },
  });

  // Drop the "Loading settings…" placeholder from console.html now that the real UI is in the
  // DOM, then move focus into the panel so Esc-to-close and keyboard nav work without a click
  // first. The 'ready' ping up to the host is a lifecycle marker — a "panel is built" signal
  // SceneHost can log or hang future setup off; the panel works fine without a reply.
  document.getElementById('console-boot')?.remove();
  panel.focus();
  tellHost({ type: 'ready' });
}
