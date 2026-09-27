// host.js — the C#<->JS bridge. This is the ONLY file that talks to the WPF host
// (MainWindow / CommsWindow / ConsoleWindow on the C# side). Everything else in
// web/js imports tellHost / onHostMessage / reportError from here and never
// touches chrome.webview directly, so there is a single seam to reason about.
//
// Bridge to the WPF host. Every call is a no-op in a plain browser, so the scene
// can be opened straight from disk while you are iterating on it.

// WebView2 injects window.chrome.webview into every page it hosts; a normal
// browser (Chrome/Firefox, or a file:// tab during dev) has no such object. So
// this one line is our "am I running inside the app?" test. If the object is
// missing, `bridge` is null and every export below quietly does nothing —
// meaning you can double-click scene.html from disk and the three.js scene still
// runs, it just can't post status up to a host that isn't there.
const bridge = globalThis.chrome?.webview ?? null;

// Page -> host. Fire-and-forget: hand a plain JSON-able object up to C#, where it
// surfaces as CoreWebView2.WebMessageReceived and gets routed by SceneHost
// (message types like 'exit', 'close', 'drag', 'comms-hello', 'llm', ...).
// The `?.` short-circuits to undefined in a plain browser, and the try/catch
// covers the WebView2 teardown race (the page can outlive the bridge for a
// frame or two). Either way the scene must survive a missing host, so we swallow.
export function tellHost(payload) {
  try {
    bridge?.postMessage(payload);
  } catch {
    /* The scene must survive a missing host. */
  }
}

// Host -> page. C# calls CoreWebView2.PostWebMessageAsJson(...) and WebView2
// raises a 'message' event on chrome.webview with the payload. We register the
// caller's handler for it — but only if the bridge exists. In a plain browser
// there is nothing to subscribe to, so we return early and the caller simply
// never hears from a host (which is fine: nothing is driving the scene remotely).
//
// PostWebMessageAsJson delivers event.data already parsed to an object, but
// PostWebMessage (raw string) delivers a string — so we defensively JSON.parse
// strings. We also require a string `type` field before dispatching, since that
// is the discriminator every handler switches on.
export function onHostMessage(handler) {
  if (!bridge) return;
  bridge.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? safeParse(event.data) : event.data;
    if (data && typeof data.type === 'string') handler(data);
  });
}

// Tolerant JSON.parse: a malformed message from the host should be dropped, not
// throw inside the WebView2 'message' event (which would just log an unhandled
// error and lose the rest of the batch). null falls through the `data && ...`
// guard above and is ignored.
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// One place to funnel scene/panel errors. Logs to the devtools console (visible
// whether or not a host is attached) AND posts { type: 'error' } up so the C#
// side can write it to Backdrop's log file — handy because a fullscreen scene
// on a second monitor has no visible console. Uses `error?.message ?? error`
// so it works whether it's handed an Error object or a bare string.
export function reportError(context, error) {
  const message = `${context}: ${error?.message ?? error}`;
  console.error(message);
  tellHost({ type: 'error', message });
}
