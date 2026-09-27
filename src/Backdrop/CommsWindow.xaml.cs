// CommsWindow.xaml.cs — the "Comms" chat/uplink panel: a small chromeless, always-on-top
// WPF window hosting its own WebView2 (comms.html) that talks to an LLM. It exists because
// the wallpaper scene is parked on the WorkerW layer and can never hold focus or receive
// input; this panel is a normal top-level window, so it CAN. Opened/closed via Win+C.

using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Backdrop.Startup;
using Microsoft.Web.WebView2.Core;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop;

/// <summary>
/// Space-themed uplink panel. Own WebView2 on the same environment as the scene so it
/// can take keyboard and mouse — the wallpaper layer cannot.
/// </summary>
public partial class CommsWindow : Window
{
    // Fake hostname the page is served under. ".invalid" is a reserved TLD that can never
    // resolve on the real internet, so a stray fetch to it fails fast instead of leaking.
    private const string VirtualHost = "backdrop.invalid";

    private readonly string _webRoot;
    private readonly bool _devTools;

    // We are handed the SCENE's already-built WebView2 environment. WebView2 allows exactly
    // one environment per user-data folder per process; sharing it lets the panel and the
    // wallpaper coexist without a second Chromium browser process (and without E_INVALIDARG
    // for a mismatched environment). See SceneHost, which owns the environment.
    private readonly CoreWebView2Environment _environment;

    // Raised for every JSON message the page posts up (window.chrome.webview.postMessage).
    // SceneHost subscribes and routes: "drag", "close", "comms-hello", LLM prompts, uploads.
    internal event Action<JsonElement>? Message;

    internal CommsWindow(string webRoot, bool devTools, CoreWebView2Environment environment)
    {
        _webRoot = webRoot;
        _devTools = devTools;
        _environment = environment;
        InitializeComponent();
        // Defer WebView2 creation until the HWND exists — EnsureCoreWebView2Async needs a
        // realized window, and we also want the final on-screen position first.
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Pin the panel to the lower-left of the work area (above the taskbar). The Max()
        // keeps it on-screen if the display is very short — never let Top go above the
        // work-area top, or the title-less window becomes hard to grab.
        var wa = SystemParameters.WorkArea;
        Left = wa.Left + 28;
        Top = Math.Max(wa.Top + 24, wa.Bottom - Height - 48);
        try { await InitializeWebViewAsync(); }
        catch (Exception ex)
        {
            Log.Write("Comms WebView2 init failed", ex);
            // Leave the opaque panel up so a failed WebView2 does not look like "never opened".
        }
    }

    private async Task InitializeWebViewAsync()
    {
        // Bring up the CoreWebView2 on the SHARED environment (see field note). Everything
        // below has to wait for this — Web.CoreWebView2 is null until it completes.
        await Web.EnsureCoreWebView2Async(_environment);
        var core = Web.CoreWebView2;

        // WebView2's DefaultBackgroundColor with an alpha of 255 keeps the
        // surface opaque — that is the load-bearing half of the input fix. The
        // old alpha-0 + AllowsTransparency combination turned this into a
        // layered window whose child-HWND airspace boundary swallowed keyboard
        // focus (typing went nowhere) and broke caption dragging. Opaque paints
        // the page shell's own dark colour here; comms.css matches it.
        try { Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 5, 7, 15); }
        catch (Exception ex) { Log.Write("Comms DefaultBackgroundColor", ex); }

        // Lock the browser down. DevTools / context menu / F12-style accelerator keys are
        // gated behind --devtools; the rest (status bar, zoom, autofill, password save,
        // edge-swipe back/forward) are just noise for a single-page local app.
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = _devTools;
        s.AreDevToolsEnabled = _devTools;
        s.AreBrowserAcceleratorKeysEnabled = _devTools;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;

        // The page → host channel. comms.html posts JSON; we parse it, Clone() the element
        // (the JsonDocument is disposed the moment this handler returns, so the raw element
        // would dangle), and hand it to whoever subscribed to Message.
        core.WebMessageReceived += (_, ev) =>
        {
            try
            {
                using var doc = JsonDocument.Parse(ev.WebMessageAsJson);
                Message?.Invoke(doc.RootElement.Clone());
            }
            catch (Exception ex)
            {
                Log.Write("Bad comms message", ex);
            }
        };

        // Serve _webRoot as https://backdrop.invalid/ — same web folder the scene uses, so
        // comms.html and the scene share one asset mirror (src/Backdrop/web ↔ deployed site).
        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.Allow);

        // Belt-and-braces containment: swallow any window.open, and cancel any navigation
        // that tries to leave the virtual host. The panel can only ever show our own page.
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        // ?v=9 is the cache-buster: WebView2 caches aggressively under the shared user-data
        // folder, so we bump this integer whenever comms.html/its assets change to force a
        // fresh load. Keep it in lockstep with the ?v= inside comms.html itself.
        core.Navigate($"https://{VirtualHost}/comms.html?v=9");
    }

    // Host → page. The mirror of WebMessageReceived: serialize an anonymous object to JSON
    // and push it down. SceneHost uses this for LLM model lists, streamed replies, upload
    // acks, carrier status. Null-safe because a message can race the WebView2 teardown.
    internal void Send(object payload)
    {
        try
        {
            Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
        }
        catch (Exception ex)
        {
            Log.Write("Comms PostWebMessage failed", ex);
        }
    }

    /// <summary>WebView2 ate the mouse-down; tell Win32 this HWND is a caption so the user can still drag.</summary>
    // The window has no title bar (WindowStyle=None), so there's nothing to grab. comms.html
    // has a "drag bar" strip; on pointerdown it posts {type:"drag"} and SceneHost calls this.
    // The trick: ReleaseCapture() so the WebView2/child HWND lets go of the mouse, then post
    // a synthetic WM_NCLBUTTONDOWN with HTCAPTION — Windows then runs its standard modal
    // window-move loop as if the press had landed on a real title bar. On the (restored)
    // opaque window this works the way it did before the AllowsTransparency experiment; the
    // SWP_FRAMECHANGED issued in OnSourceInitialized below keeps the non-client frame the
    // move loop hit-tests against in sync with the ex-style rewrite, so the drag engages
    // from the very first attempt.
    internal void BeginDrag()
    {
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, new IntPtr(HTCAPTION), IntPtr.Zero);
    }

    // WPF lifecycle: fires when the window is being destroyed. Dispose the WebView2
    // explicitly so its renderer/GPU child processes go away now rather than lingering
    // until GC. The shared environment is NOT ours to dispose — SceneHost owns that.
    protected override void OnClosed(EventArgs e)
    {
        try { Web?.Dispose(); }
        catch (Exception ex) { Log.Write("Comms WebView2 release", ex); }
        base.OnClosed(e);
    }

    // WPF lifecycle: fires once, right after the HWND is created and before it's shown —
    // the correct place to touch native window styles.
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // WindowStyle=None makes Windows treat this like a tool window and drop its taskbar
        // button, and ShowInTaskbar="True" in XAML isn't enough to override that for a
        // chromeless window. So we go to the metal: set WS_EX_APPWINDOW (force a taskbar
        // button) and clear WS_EX_TOOLWINDOW (stop hiding it from the taskbar / Alt+Tab).
        // Now Comms gets its own taskbar entry and can be alt-tabbed back to.
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        long ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        ex |= WS_EX_APPWINDOW;
        ex &= ~WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
        // Recompute the non-client frame for the styles we just changed. Without this the
        // cached frame is stale, which used to make the first caption-drag hit-test miss
        // (see BeginDrag). SWP_NOMOVE|NOSIZE|NOZORDER|NOACTIVATE = styles-only pass.
        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        // Focus forwarding: every activation hands keyboard focus to the WebView2 child,
        // so clicking the panel (title bar, resize grip, anywhere) leaves the caret in
        // the input — the user can just keep typing. Belt and braces for the case where
        // WPF's own focus handoff lands on the frame instead of the child.
        Activated += (_, _) =>
        {
            try { Web.Focus(); } catch { /* WebView2 not ready yet; next activation retries */ }
        };
    }
}
