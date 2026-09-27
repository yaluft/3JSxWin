// MainWindow.xaml.cs — one wallpaper surface. There is one of these per monitor (or one
// spanning all of them). Its whole job: host a WebView2 that renders the three.js scene,
// then re-parent its own HWND into Explorer's wallpaper layer so the scene draws behind
// the desktop icons. Also handles windowed / screensaver modes, and keeps itself glued
// to the layer when Explorer restarts or the display topology changes.

using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Backdrop.Interop;
using Backdrop.Startup;
using Microsoft.Web.WebView2.Core;
using static Backdrop.Interop.NativeMethods;

using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace Backdrop;

public partial class MainWindow : Window
{
    // The page is served from https://backdrop.invalid/ . ".invalid" is reserved by RFC 2606
    // and can never resolve on the real internet, so it is a safe, permanent name to map our
    // local scene folder onto (see SetVirtualHostNameToFolderMapping below). Giving the page
    // a real https origin — instead of file:// — is what unlocks ES modules, fetch, and a
    // "secure context" without us having to run an actual web server.
    private const string VirtualHost = "backdrop.invalid";

    // WM_DISPLAYCHANGE (0x007E): the OS broadcasts this when resolution or monitor layout
    // changes. Not in the WPF message set, so we catch it ourselves in WndProc. It matters
    // because a topology change rebuilds Explorer's WorkerW layer — our parent goes stale.
    private const int WM_DISPLAYCHANGE = 0x007E;

    private readonly CommandLineOptions _options;
    private readonly string _webRoot;

    // Two DispatcherTimers, both firing on the UI thread:
    //   _guard — slow heartbeat (4 s). Checks we are STILL parented into the layer and
    //            re-attaches if Explorer restarted or something re-parented us out.
    //   _retry — fast poll (0.6 s, backing off to 3 s). Only runs while we have not managed
    //            to attach yet, e.g. at sign-in before Explorer has built the wallpaper layer.
    // Note: Chromium throttles timers/rAF hard in a non-focused window, and a backdrop is
    // never focused. The flags that defeat that throttling (--disable-background-timer-
    // throttling etc.) are passed to the browser process in SceneHost, not here — these two
    // timers are plain WPF timers and are not affected.
    private readonly DispatcherTimer _guard;
    private readonly DispatcherTimer _retry;

    // The single app-wide CoreWebView2Environment. A second environment pointed at the same
    // user-data folder throws ERROR_NOT_IN_CORRECT_STATE, so every window borrows this one.
    private readonly CoreWebView2Environment? _sharedEnvironment;

    // Cancelled on teardown. WebView2 init is async and can outlive a fast close, so the
    // OnLoaded path checks this token to bail instead of touching a half-disposed control.
    private readonly CancellationTokenSource _lifetime = new();

    private RECT _bounds;
    private int _attempts;

    private IntPtr _hwnd;         // this window's native handle, cached in OnSourceInitialized
    private LayerResult _layer;   // the WorkerW/Progman handle we last parented into
    private bool _attached;       // true once SetParent into the layer has stuck
    private bool _ready;          // true once the scene has posted its "ready" message
    private bool _webReleased;    // guards ReleaseWeb so we only tear the Chromium HWND down once

    internal bool IsWindowedMode { get; private set; }

    /// <summary>Raised when Windows reports a resolution/monitor-topology change, in
    /// addition to this window's own re-attach. SceneHost listens to rebuild the window
    /// set in Duplicate mode, where the number of windows itself may need to change.</summary>
    internal event Action? DisplayChanged;

    /// <summary>Raised for scene-initiated config changes ("live" messages, e.g. a
    /// palette shuffle fired by Win+P). SceneHost persists them to config.json and
    /// relays them to the other monitors, so what the scene decides survives a reload.</summary>
    internal event Action<JsonElement>? SceneMessage;

    /// <param name="bounds">The physical-pixel rectangle this window should cover. Ignored
    /// in windowed mode, where the window centers itself at a fixed size instead.</param>
    /// <param name="sharedEnvironment">
    /// The one CoreWebView2Environment for the whole app. A second environment on the same
    /// user-data folder throws ERROR_NOT_IN_CORRECT_STATE, so every window (and the console)
    /// reuses the same instance rather than creating its own.
    /// </param>
    internal MainWindow(CommandLineOptions options, RECT bounds, CoreWebView2Environment sharedEnvironment, bool windowed)
    {
        _options = options;
        _bounds = bounds;
        _sharedEnvironment = sharedEnvironment;
        IsWindowedMode = windowed;

        // Where the HTML/JS/GLSL lives: a --scene override folder if it exists, else the
        // "web" folder shipped next to the exe.
        _webRoot = ResolveWebRoot(options.SceneFolder);

        InitializeComponent();

        if (IsWindowedMode)
        {
            // Debug / preview: a normal titled window. Screensaver adds its own borderless
            // full-screen chrome on top of that.
            ApplyWindowedChrome();
            if (_options.ScreensaverRun) ApplyScreensaverChrome();
        }
        else
        {
            // Park off-screen so nobody sees a bare window between Show() and the
            // moment it lands on the wallpaper layer. -32000 is the classic "hidden
            // window" position — far enough out that it can't peek onto any monitor.
            Left = -32000;
            Top = -32000;
        }

        // Slow heartbeat: is the scene still on the layer? Re-attaches if not.
        _guard = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _guard.Tick += (_, _) => VerifyAttachment();

        // At sign-in, Explorer often has not built the wallpaper layer yet. Rather than
        // give up and become a window, keep asking until it exists.
        _retry = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
        _retry.Tick += (_, _) => AttachToDesktop();

        // Loaded fires after the HWND exists and the visual tree is up — the right moment
        // to spin up WebView2. Closing tears the Chromium HWND down before WPF kills ours.
        Loaded += OnLoaded;
        Closing += (_, _) => ReleaseWeb();
    }

    // --scene <path> lets a theme author point Backdrop at their own working copy. If the
    // path is given but missing we log and fall back rather than failing to start — a typo
    // in a shortcut should still give you a wallpaper.
    private static string ResolveWebRoot(string? overridePath)
    {
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            string full = Path.GetFullPath(overridePath);
            if (Directory.Exists(full)) return full;
            Log.Write($"Scene folder not found, falling back to bundled: {full}");
        }
        return Path.Combine(AppContext.BaseDirectory, "web");
    }

    /// <summary>
    /// WPF lifecycle hook: fires the instant the window's HWND has been created but before
    /// it is shown. This is the earliest point we can touch native window state, so we grab
    /// the handle, subscribe our WndProc to the message pump, and (in desktop mode) hide the
    /// half-built window from the taskbar and Alt+Tab so a slow attach never flashes a
    /// stray window at the user.
    /// </summary>
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        // Cache the HWND once. Every P/Invoke below needs it; WindowInteropHelper.Handle
        // is only non-zero from here on.
        _hwnd = new WindowInteropHelper(this).Handle;

        // Hook the raw Win32 message loop so WndProc sees messages WPF doesn't surface —
        // specifically WM_DISPLAYCHANGE.
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);

        if (!IsWindowedMode) HideFromShell();
    }

    /// <summary>
    /// Keeps the window out of Alt+Tab and the taskbar while it is still trying to reach
    /// the desktop layer, so a slow attach never shows up as a stray window.
    /// </summary>
    private void HideFromShell()
    {
        // Read the current extended-style bitfield, clear APPWINDOW (which forces a taskbar
        // button), then OR in TOOLWINDOW (no taskbar / no Alt+Tab) and NOACTIVATE (clicking
        // it never makes it the foreground window). DesktopLayer.Attach sets the same bits
        // again after re-parenting — this call just covers the window while it is still a
        // top-level popup waiting for the layer.
        long ex = GetWindowLong(_hwnd, GWL_EXSTYLE);
        ex &= ~WS_EX_APPWINDOW;
        ex |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(_hwnd, GWL_EXSTYLE, ex);
    }

    // Our hook into the raw Win32 message pump. We only care about one message here.
    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // Only WM_DISPLAYCHANGE forces a re-attach: a resolution or monitor change rebuilds
        // the WorkerW layer, so the old parent is stale. WM_SETTINGCHANGE deliberately does
        // NOT re-attach — it fires for countless unrelated events (theme tweaks, DPI, even
        // simply opening our own console window), and reparenting on each one yanks the
        // scene off the layer mid-render, flashing the default wallpaper. The 4-second guard
        // timer already recovers a genuinely lost layer by checking the real parent, with no
        // false hits, so ignoring WM_SETTINGCHANGE costs us nothing.
        if (msg == WM_DISPLAYCHANGE)
        {
            // Tell SceneHost first — in Duplicate mode the monitor count itself may have
            // changed, so the whole window set has to be rebuilt, not just re-attached.
            DisplayChanged?.Invoke();

            // Re-parent ourselves onto the fresh layer. Queued at Background priority so it
            // runs after the OS has finished settling the new topology, not mid-broadcast.
            if (_attached)
            {
                Dispatcher.BeginInvoke(() => AttachToDesktop(), DispatcherPriority.Background);
            }
        }

        // Return zero and leave `handled` false: we observe these messages, we don't consume
        // them — WPF and the default WndProc still need to see them.
        return IntPtr.Zero;
    }

    // async void because it is an event handler — there is no Task for anyone to await, so
    // every exception path has to be caught right here or it crashes the process.
    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync(_lifetime.Token);
            if (_lifetime.IsCancellationRequested) return;
        }
        catch (OperationCanceledException)
        {
            // Window closed while WebView2 was still starting. Nothing to do.
            return;
        }
        catch (Exception ex)
        {
            Log.Write("WebView2 init failed", ex);
            MessageBox.Show(
                $"Backdrop could not start the WebView2 runtime.\n\n{ex.Message}\n\nSee {Log.File}",
                "Backdrop", MessageBoxButton.OK, MessageBoxImage.Error);
            Application.Current.Shutdown();
            return;
        }

        // WebView2 is live and navigating. Now put the window where it belongs: centered
        // as a normal window, or re-parented onto the wallpaper layer.
        if (IsWindowedMode) CenterOnPrimary();
        else AttachToDesktop();
    }

    // ---------------------------------------------------------------- WebView2

    private async Task InitializeWebViewAsync(CancellationToken cancel)
    {
        // Hand the shared environment to this window's WebView2 control. Passing the same
        // instance every time is what keeps us to one Chromium browser process / one
        // user-data lock across every monitor and the console window.
        await Web.EnsureCoreWebView2Async(_sharedEnvironment);
        cancel.ThrowIfCancellationRequested();

        var core = Web.CoreWebView2;

        // Near-black (#04060C) so the very first painted frame — before the WebGL canvas has
        // anything in it — matches the scene's dark background instead of flashing white.
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 4, 6, 12);

        // Lock the browser down to "kiosk that renders one page". Context menu, DevTools and
        // F12/Ctrl-R accelerator keys are gated behind --dev-tools; everything else that a
        // full browser offers (status bar, zoom, autofill, password save, swipe-to-navigate,
        // the built-in error page) is off because a wallpaper has no use for any of it and
        // the user can't interact with it anyway.
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = _options.DevTools;
        s.AreDevToolsEnabled = _options.DevTools;
        s.AreBrowserAcceleratorKeysEnabled = _options.DevTools;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsBuiltInErrorPageEnabled = false;

        // The JS side posts status back to us (ready / error / announce / exit) via
        // chrome.webview.postMessage; OnWebMessage is the C# end of that bridge.
        core.WebMessageReceived += OnWebMessage;

        // Map https://backdrop.invalid/ -> the scene folder on disk. The page now loads as if
        // from a real web server: it gets an https origin, so ES modules, fetch(), and
        // "secure context" APIs all work — none of which they do from a file:// page.
        // Access kind Allow (not DenyCors): a dynamic import() of a theme module counts as a
        // cross-origin fetch even within the same virtual host. With DenyCors, optional
        // themes silently failed to load and createScene fell back to the Aurora sky while
        // the UI still showed the picked theme's name.
        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.Allow);

        // Belt and braces: this app must never leave the scene. Block popups outright, and
        // cancel any navigation whose URL is not under our virtual host (a stray link, a
        // redirect, a devtools-typed address).
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        cancel.ThrowIfCancellationRequested();

        // Screensaver rule: any input exits. Inject a tiny script at document-creation time
        // (so it is in place before the scene's own code runs) that forwards the first
        // pointer or key event back to us as an "exit" message. try/catch because the bridge
        // isn't guaranteed present the instant the listener fires.
        if (_options.ScreensaverRun)
        {
            _ = core.AddScriptToExecuteOnDocumentCreatedAsync(
                "document.addEventListener('pointerdown',function(){try{chrome.webview.postMessage({type:'exit'})}catch(e){}});"
                + "document.addEventListener('keydown',function(){try{chrome.webview.postMessage({type:'exit'})}catch(e){}});");
        }

        // Build the scene URL. The query string carries the CLI options through to the JS.
        // The v= parameter is a cache-buster: its value is the mtime of main.js in ticks, so
        // whenever you edit the scene the URL changes and WebView2 can't serve a stale
        // cached index.html / bundle. Same ?v=N trick the JS uses on its own imports.
        string query = _options.ToQueryString();
        string stamp = File.GetLastWriteTimeUtc(Path.Combine(_webRoot, "js", "main.js")).Ticks.ToString("x");
        string join = string.IsNullOrEmpty(query) ? "?" : "&";
        core.Navigate($"https://{VirtualHost}/index.html{query}{join}v={stamp}");
        Log.Write($"Scene served from {_webRoot}");
    }

    // The C# end of the JS -> host bridge. Every message is a small JSON object with a
    // "type" field; anything without one, or any malformed payload, is ignored.
    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("type", out var type)) return;

            switch (type.GetString())
            {
                case "ready":
                    // Scene has finished its first real frame. Only now is Send() allowed to
                    // post messages in. We also grab the browser process id here and stash
                    // it via WebViewLifetime so the NEXT launch can reap a leaked Chromium.
                    _ready = true;
                    Log.Write("Scene ready");
                    try
                    {
                        if (Web.CoreWebView2 is { } core)
                            WebViewLifetime.Remember(core.BrowserProcessId);
                    }
                    catch (Exception ex)
                    {
                        Log.Write("Could not read WebView2 browser pid", ex);
                    }
                    break;
                case "error":
                    // Scene-side failure (bad shader, missing asset). Log it; the scene
                    // handles its own fallback.
                    Log.Write($"Scene error: {doc.RootElement.GetProperty("message").GetString()}");
                    break;
                case "announce":
                    // Scene / palette changed — purely informational, goes to the log so a
                    // "why did it switch?" question is answerable after the fact.
                    Log.Write($"Switch {doc.RootElement.GetProperty("scene").GetString()} · {doc.RootElement.GetProperty("palette").GetString()}");
                    break;
                case "live":
                    // The scene changed its own config at runtime (palette shuffle via
                    // Win+P, a dock click, ...). Hand it to SceneHost, which persists it
                    // and syncs the other monitors. Clone() — the document dies on return.
                    if (doc.RootElement.TryGetProperty("config", out var liveConfig))
                        SceneMessage?.Invoke(liveConfig.Clone());
                    break;
                case "exit":
                    // Only the screensaver injects code that sends this (see the script
                    // above). In wallpaper mode nothing posts "exit", so this is a no-op.
                    if (_options.ScreensaverRun) Application.Current.Shutdown();
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Write("Bad web message", ex);
        }
    }

    // The host -> JS direction of the bridge. Serialises `payload` to JSON and posts it in.
    // Silently drops the message if the scene hasn't signalled "ready" yet or the control
    // is gone — callers (tray menu, console) fire these freely and shouldn't have to check.
    internal void Send(object payload)
    {
        if (!_ready || Web.CoreWebView2 is null) return;
        try
        {
            Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
        }
        catch (Exception ex)
        {
            Log.Write("PostWebMessage failed", ex);
        }
    }

    // ------------------------------------------------------------ desktop layer

    /// <summary>
    /// The heart of "live wallpaper". Finds Explorer's WorkerW layer (the blank window that
    /// sits above the wallpaper bitmap and below the desktop icons) and SetParent()s our
    /// HWND into it, so the WebGL scene renders behind the icons. If the layer isn't there
    /// yet — common right after sign-in or an Explorer restart — it does NOT fall back to a
    /// visible window; it schedules _retry and keeps asking until Explorer builds the layer.
    /// The actual Win32 dance (SetParent, style rewrite, HWND_BOTTOM) lives in DesktopLayer.
    /// </summary>
    private void AttachToDesktop()
    {
        if (IsWindowedMode) return;

        _attempts++;
        _layer = DesktopLayer.Find();
        _attached = DesktopLayer.Attach(_hwnd, _layer, out string failure);

        // If Explorer destroyed the WorkerW in the race between Find() and SetParent(),
        // the OS returns ERROR_INVALID_WINDOW_HANDLE (1400). Re-find and retry once
        // immediately rather than waiting for the slow retry timer — the new WorkerW is
        // usually already live by the time we get here.
        if (!_attached && failure.Contains("stale"))
        {
            _layer = DesktopLayer.Find();
            _attached = DesktopLayer.Attach(_hwnd, _layer, out failure);
        }

        if (_attached)
        {
            // Landed. Stop polling, size/position the window over its target monitor, and
            // start the slow guard timer that watches for the layer disappearing.
            _retry.Stop();
            ApplyBounds();
            Log.Write($"Attached to {_layer.Kind} on attempt {_attempts} - {_layer.Detail}");
            _attempts = 0;
            _guard.Start();
            return;
        }

        // No fallback to a plain window. The desktop is the only place this belongs, so
        // back off and keep asking - Explorer usually catches up within a few seconds of
        // sign-in, and an Explorer restart is a transient too.
        if (_attempts == 1)
        {
            Log.Write($"Not attached yet: {failure}");
            Log.Write(DesktopLayer.Describe());
        }
        else if (_attempts % 20 == 0)
        {
            Log.Write($"Still not attached after {_attempts} attempts: {failure}");
        }

        // Back-off schedule: hammer it every 600 ms for the first ~5 seconds (covers the
        // normal sign-in delay), then drop to once every 3 seconds so a machine where the
        // layer genuinely never appears isn't spinning a tight loop forever.
        _retry.Interval = _attempts < 8 ? TimeSpan.FromMilliseconds(600) : TimeSpan.FromSeconds(3);
        _retry.Start();
    }

    /// <summary>
    /// The _guard heartbeat. Confirms we are still a child of the same layer handle and
    /// re-attaches if not. Uses GetAncestor(GA_PARENT), not GetParent: GetParent returns the
    /// OWNER for anything with WS_POPUP and is unreliable here, whereas GA_PARENT always
    /// reports the true parent. A failed check means Explorer restarted (new WorkerW, old
    /// handle dead) or another live-wallpaper tool re-parented us out.
    /// </summary>
    private void VerifyAttachment()
    {
        if (!_attached || IsWindowedMode) return;
        if (IsWindow(_layer.Handle) && GetAncestor(_hwnd, GA_PARENT) == _layer.Handle) return;

        // Explorer restarted, or something re-parented us out of the layer.
        Log.Write("Lost the desktop layer; re-attaching.");
        _attached = false;
        _attempts = 0;
        AttachToDesktop();
    }

    // ------------------------------------------------------------- webRoot access

    /// <summary>The scene folder this window serves. Every window in a group shares the
    /// same value (same --scene override applies uniformly), so SceneHost can read any one
    /// window's copy for the console and config I/O.</summary>
    internal string WebRoot => _webRoot;

    // Sizes and positions the window to cover exactly its target monitor rectangle. Called
    // after every successful attach and on every Retarget. The ordering in here is load-
    // bearing and hard-won — read the two comment blocks below before touching it.
    private void ApplyBounds()
    {
        RECT target = _bounds;

        int x = target.Left;
        int y = target.Top;

        if (_attached)
        {
            // Child coordinates are relative to the wallpaper layer, whose origin is the
            // top-left of the virtual screen (which can be negative on multi-monitor rigs).
            var (ox, oy) = MonitorLayout.VirtualOrigin;
            x -= ox;
            y -= oy;
        }

        // Order matters. First give WPF a logical size that scales back up to the physical
        // target: WPF sizes its content tree — and therefore the WebView2 swap chain — in
        // DIPs, and it applies a single monitor's DPI to the whole window. Left alone it
        // divides the full physical width by one scale factor, so on a span the scene stops
        // partway across the second monitor. Setting Width/Height in DIPs makes the layout
        // multiply back up to cover everything.
        double scale = MonitorLayout.ScaleFactorFor(_hwnd);
        Width = target.Width / scale;
        Height = target.Height / scale;

        // Then assert the physical rectangle last. Setting Width/Height above makes WPF
        // reposition its own HWND from the logical values; this SetWindowPos overrides that
        // with exact physical pixels and re-asserts the bottom of the z-order. Explorer
        // shuffles its children whenever the desktop is refreshed, and coming back up on top
        // would hide the icons.
        IntPtr insertAfter = _attached ? HWND_BOTTOM : IntPtr.Zero;
        uint flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED;
        if (!_attached) flags |= SWP_NOZORDER;

        SetWindowPos(_hwnd, insertAfter, x, y, target.Width, target.Height, flags);
    }

    // ------------------------------------------------------------------- modes

    // Debug / preview mode: an ordinary resizable window with a title bar and a taskbar
    // button, so you can watch the scene without it disappearing behind the desktop.
    private void ApplyWindowedChrome()
    {
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.CanResize;
        ShowInTaskbar = true;
    }

    // Screensaver mode: borderless, non-resizable, always-on-top, maximized to fill the
    // screen. The injected input-exits-screensaver script (see InitializeWebViewAsync)
    // does the rest.
    private void ApplyScreensaverChrome()
    {
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        WindowState = WindowState.Maximized;
    }

    // Center in the primary monitor's work area. SystemParameters values are in DIPs, which
    // is also what Left/Top/Width/Height take, so no DPI math needed here.
    private void CenterOnPrimary()
    {
        Left = (SystemParameters.PrimaryScreenWidth - Width) / 2;
        Top = (SystemParameters.PrimaryScreenHeight - Height) / 2;
    }

    /// <summary>
    /// Live switch from wallpaper to a normal window (tray "Show window"). Stops both
    /// timers, Detach()es from the layer to restore the top-level popup styles, then gives
    /// the window a fixed 1280x720 size and shows it. The reverse of SwitchToDesktop.
    /// </summary>
    internal void SwitchToWindowed()
    {
        if (IsWindowedMode) return;

        _guard.Stop();
        _retry.Stop();
        if (_attached) DesktopLayer.Detach(_hwnd);
        _attached = false;
        _attempts = 0;
        IsWindowedMode = true;

        ApplyWindowedChrome();
        Width = 1280;
        Height = 720;
        CenterOnPrimary();
        Show();
        Activate();
    }

    /// <summary>
    /// Live switch from a normal window back onto the wallpaper layer (tray "Send to
    /// desktop"). Strips the chrome, hides it from the shell, parks it off-screen, then
    /// runs the attach loop again.
    /// </summary>
    internal void SwitchToDesktop()
    {
        if (!IsWindowedMode) return;

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        IsWindowedMode = false;

        HideFromShell();
        Left = -32000;
        Top = -32000;
        _attempts = 0;
        AttachToDesktop();
    }

    /// <summary>Changes the physical rectangle this window covers and re-applies it. Used
    /// when SceneHost switches between Single and Span without changing the window count.</summary>
    internal void Retarget(RECT bounds)
    {
        _bounds = bounds;
        if (!IsWindowedMode) ApplyBounds();
    }

    /// <summary>
    /// Reloads the page. Accessing CoreWebView2 after Dispose throws rather than
    /// returning null, so this must catch — the tray click runs on the WinForms
    /// thread and an unhandled throw becomes the JIT dialog.
    /// </summary>
    /// <returns>True if Reload was issued.</returns>
    internal bool TryReloadScene()
    {
        if (_webReleased) return false;
        try
        {
            if (Web.CoreWebView2 is not { } core) return false;
            core.Reload();
            return true;
        }
        catch (Exception ex)
        {
            Log.Write("Reload skipped; WebView2 not ready", ex);
            return false;
        }
    }

    // Tray "Developer tools" / the secret Win+Shift+U chord. Opens the Chromium
    // DevTools window against the scene. `force` (the hotkey path) flips
    // AreDevToolsEnabled on first — the app normally ships with DevTools gated
    // behind --devtools, and the secret chord is meant to work regardless.
    internal void OpenDevTools(bool force = false)
    {
        try
        {
            if (Web.CoreWebView2 is not { } core) return;
            if (force) core.Settings.AreDevToolsEnabled = true;
            core.OpenDevToolsWindow();
        }
        catch (Exception ex)
        {
            Log.Write("DevTools unavailable", ex);
        }
    }

    // Tray "Open scene folder". Hands _webRoot to the shell so it opens in Explorer.
    internal void OpenSceneFolder()
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = _webRoot,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Write("Could not open scene folder", ex);
        }
    }

    // Tray "Copy diagnostics". Dumps the full shell window tree (Progman / WorkerW /
    // DefView) to the log and the clipboard — the first thing to ask for when the
    // wallpaper won't attach on someone's machine.
    internal void CopyDiagnostics()
    {
        string report = DesktopLayer.Describe();
        Log.Write("Diagnostics:" + Environment.NewLine + report);

        try
        {
            System.Windows.Clipboard.SetText(report);
            MessageBox.Show(report + Environment.NewLine + "(copied to the clipboard)",
                "Backdrop diagnostics", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            Log.Write("Clipboard unavailable", ex);
            MessageBox.Show(report, "Backdrop diagnostics", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    // Tray "Open log". Opens the running log file in the default text editor.
    internal void OpenLog()
    {
        try
        {
            Log.Write("Log opened from tray.");
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = Log.File,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Write("Could not open log", ex);
        }
    }

    /// <summary>
    /// Tear the Chromium HWND down before the WPF window dies. Closing two dual-monitor
    /// WebViews at once otherwise races Chromium's class unregister (Win32 1412).
    /// </summary>
    internal void ReleaseWeb()
    {
        if (_webReleased) return;
        _webReleased = true;

        // Cancel any in-flight WebView2 init, kill the timers, then detach and dispose.
        // Order: stop feeding the scene (Stop) before pulling it down (Dispose); detach
        // from the layer first so we don't leave a dead child parented into Explorer.
        try { _lifetime.Cancel(); } catch { /* already cancelled */ }
        _guard.Stop();
        _retry.Stop();
        try
        {
            if (_attached) DesktopLayer.Detach(_hwnd);
            _attached = false;
            Web?.CoreWebView2?.Stop();
            Web?.Dispose();
        }
        catch (Exception ex)
        {
            Log.Write("WebView2 release", ex);
        }
    }
}
