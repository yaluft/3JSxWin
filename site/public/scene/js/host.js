// Bridge to the WPF host. Every call is a no-op in a plain browser, so the scene
// can be opened straight from disk while you are iterating on it.

const bridge = globalThis.chrome?.webview ?? null;

export function tellHost(payload) {
  try {
    bridge?.postMessage(payload);
  } catch {
    /* The scene must survive a missing host. */
  }
}

export function onHostMessage(handler) {
  if (!bridge) return;
  bridge.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? safeParse(event.data) : event.data;
    if (data && typeof data.type === 'string') handler(data);
  });
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function reportError(context, error) {
  const message = `${context}: ${error?.message ?? error}`;
  console.error(message);
  tellHost({ type: 'error', message });
}
