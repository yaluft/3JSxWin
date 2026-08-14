// Entry point for the standalone console window. This page is NOT the scene — it hosts
// only the control panel, in its own small always-on-top window, so opening the console
// never disturbs the fullscreen backdrop behind the icons.
//
// Every edit is forwarded to the host, which relays it to the scene window to apply live.
// Save/reset/close go to the host too.

import { loadConfig } from './config.js';
import { createPanel } from './panel.js';
import { tellHost, reportError } from './host.js';

boot().catch((error) => reportError('console-boot', error));

async function boot() {
  const config = await loadConfig();

  const panel = createPanel(config, {
    onChange(draft) {
      // Relay the whole edited config to the host each change; the scene applies it live.
      tellHost({ type: 'live', config: draft });
    },
    onCommand(name, payload) {
      if (name === 'save') tellHost({ type: 'savecfg', config: payload.config, reload: payload.reload });
      else if (name === 'reset') tellHost({ type: 'resetcfg' });
      else if (name === 'shuffle') tellHost({ type: 'shuffle' });
      else if (name === 'close') tellHost({ type: 'close' });
    },
  });

  document.getElementById('console-boot')?.remove();
  panel.focus();
  tellHost({ type: 'ready' });
}
