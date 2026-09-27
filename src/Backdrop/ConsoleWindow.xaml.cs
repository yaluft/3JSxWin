// ConsoleWindow.xaml.cs — the settings panel window.
// A tiny always-on-top window hosting a SECOND WebView2 that loads console.html
// (the panel UI, no three.js scene). It never touches config itself: every edit
// is JSON-posted up to SceneHost, which relays it live to the scene and to disk.

using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Backdrop.Startup;
using Microsoft.Web.WebView2.Core;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop;

/// <summary>
/// The control console in its own small, transparent, always-on-top window. It hosts a
/// second WebView2 that loads console.html — the panel only, no scene. Keeping it separate
/// is the whole point: the fullscreen backdrop never moves or comes to the foreground when
/// you open the console, so the desktop, taskbar, and apps stay visible and usable.
///
/// The console never mutates config itself. Every edit and command is raised to the owner
/// (MainWindow) as a parsed JSON message, which relays live edits to the scene and persists.
/// </summary>
public partial class ConsoleWindow : Window
{
    // Any origin works for SetVirtualHostNameToFolderMapping — we just need one that
    // can never resolve on the real internet. ".invalid" is reserved by RFC 2606 for
    // exactly this, so a stray fetch to it fails fast instead of hitting a live host.
    // Must match the host the scene's WebView2 uses so both share one on-disk origin
    // (localStorage, caches) — see MainWindow / the src/site mirror.
    private const string VirtualHost = "backdrop.invalid";

    // The web/ folder to serve as that virtual host. Passed in from SceneHost so the
    // console serves the exact same files the scene does (bundled folder, or --scene).
    private readonly string _webRoot;
    private readonly bool _devTools;

    // The ONE CoreWebView2Environment the whole app shares. WebView2 refuses a second
    // environment pointed at the same user-data folder, so SceneHost creates it once
    // and hands the same instance to every window. See InitializeWebViewAsync.
    private readonly CoreWebView2Environment _environment;

    /// <summary>Raised with each web message from the console page (already JSON-parsed).</summary>
    // SceneHost subscribes to this. The panel posts JSON ("live" edits, "savecfg",
    // "host" actions...); we parse it here and hand the JsonElement up. The window
    // is a dumb pipe — all the routing logic lives in SceneHost.OnConsoleMessage.
    internal event Action<JsonElement>? Message;

    internal ConsoleWindow(string webRoot, bool devTools, CoreWebView2Environment environment)
    {
        _webRoot = webRoot;
        _devTools = devTools;
        _environment = environment;
        InitializeComponent();
        // Defer WebView2 setup to Loaded: the HWND has to exist before the control
        // can create its browser, and Loaded is the first point where it does.
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        PlaceTopRight();
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            // If the panel's WebView2 can't start there is nothing useful to show —
            // just log and close. The scene keeps running; the user can retry the
            // hotkey. (Comms, by contrast, leaves its shell up on failure.)
            Log.Write("Console WebView2 init failed", ex);
            Close();
        }
    }

    /// <summary>Opens the console near the top-right of the primary work area.</summary>
    // WorkArea, not the full screen bounds, so we sit clear of the taskbar. The 32px
    // inset just keeps it off the screen edge. WindowStartupLocation="Manual" in the
    // XAML is what lets us set Left/Top ourselves here.
    private void PlaceTopRight()
    {
        var wa = SystemParameters.WorkArea;
        Left = wa.Right - Width - 32;
        Top = wa.Top + 32;
    }

    private async Task InitializeWebViewAsync()
    {
        // Reuse the scene's environment — a second environment on the same user-data folder
        // fails with ERROR_NOT_IN_CORRECT_STATE. One environment can back many controllers,
        // so the scene window(s) and this panel are all separate WebView2s on one browser
        // process, sharing one cache and one localStorage.
        await Web.EnsureCoreWebView2Async(_environment);

        var core = Web.CoreWebView2;

        // Opaque, the scene's void colour. A transparent WebView2 inside an
        // AllowsTransparency WPF window is the classic airspace trap — the control goes
        // non-interactive because an HWND-based WebView2 can't composite into a layered
        // window. Solid background keeps clicks live. (This is why the XAML sets
        // AllowsTransparency="False" — the panel is a normal opaque window; only the
        // scene and Comms play the transparency game.) The colour matches style.css's
        // .console-page base so the first painted frame blends with the panel shell.
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 5, 7, 15);

        // Lock the panel down to a kiosk-style app surface: no right-click menu, no F12,
        // no browser hotkeys unless --devtools is on; and none of the consumer-browser
        // features (status bar, zoom, password save, autofill, edge-swipe back/forward)
        // that only make sense for real web browsing.
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = _devTools;
        s.AreDevToolsEnabled = _devTools;
        s.AreBrowserAcceleratorKeysEnabled = _devTools;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;

        // The bridge: panel JS calls window.chrome.webview.postMessage(obj); it surfaces
        // here. Parse it, Clone() the root (the JsonDocument is disposed at the end of this
        // scope, so the borrowed element would go invalid), and raise it to SceneHost.
        // A malformed message is logged and dropped — never allowed to kill the panel.
        core.WebMessageReceived += (_, ev) =>
        {
            try
            {
                using var doc = JsonDocument.Parse(ev.WebMessageAsJson);
                Message?.Invoke(doc.RootElement.Clone());
            }
            catch (Exception ex)
            {
                Log.Write("Bad console message", ex);
            }
        };

        // Serve _webRoot as https://backdrop.invalid/ so the page loads over a real
        // https origin (needed for modules, localStorage, etc.) with no web server.
        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.Allow);

        // Lock navigation to that origin: swallow popups, and cancel any attempt to
        // navigate away (a stray link, a redirect). The panel is a fixed local page,
        // never a browser.
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        core.Navigate($"https://{VirtualHost}/console.html");
    }

    // WPF lifecycle: fires when the window closes. Dispose the WebView2 explicitly so
    // its browser-side resources (renderer process share, the virtual-host mapping) are
    // torn down now rather than whenever the finalizer runs. The shared _environment is
    // NOT ours to dispose — SceneHost owns it and other windows still need it.
    protected override void OnClosed(EventArgs e)
    {
        try { Web?.Dispose(); }
        catch (Exception ex) { Log.Write("Console WebView2 release", ex); }
        base.OnClosed(e);
    }

    // WPF lifecycle: fires once, right after the native HWND exists — the first moment
    // we can call Win32 on this window. We tweak the extended window styles here because
    // WPF has no property for WS_EX_TOOLWINDOW.
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        // Keep the console off Alt+Tab and the taskbar; it is a tool, not an app window.
        // Clear WS_EX_APPWINDOW (forces a taskbar button) and set WS_EX_TOOLWINDOW
        // (hides from Alt+Tab and the taskbar). Comms does the exact opposite — it
        // wants its own taskbar entry.
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        long ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        ex &= ~WS_EX_APPWINDOW;
        ex |= WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    }
}
