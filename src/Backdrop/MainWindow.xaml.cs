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
    private const string VirtualHost = "backdrop.invalid";
    private const int WM_DISPLAYCHANGE = 0x007E;

    private readonly CommandLineOptions _options;
    private readonly string _webRoot;
    private readonly DispatcherTimer _guard;
    private readonly DispatcherTimer _retry;
    private readonly CoreWebView2Environment? _sharedEnvironment;
    private readonly CancellationTokenSource _lifetime = new();
    private RECT _bounds;
    private int _attempts;

    private IntPtr _hwnd;
    private LayerResult _layer;
    private bool _attached;
    private bool _ready;
    private bool _webReleased;

    internal bool IsWindowedMode { get; private set; }

    /// <summary>Raised when Windows reports a resolution/monitor-topology change, in
    /// addition to this window's own re-attach. SceneHost listens to rebuild the window
    /// set in Duplicate mode, where the number of windows itself may need to change.</summary>
    internal event Action? DisplayChanged;

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

        _webRoot = ResolveWebRoot(options.SceneFolder);

        InitializeComponent();

        if (IsWindowedMode)
        {
            ApplyWindowedChrome();
        }
        else
        {
            // Park off-screen so nobody sees a bare window between Show() and the
            // moment it lands on the wallpaper layer.
            Left = -32000;
            Top = -32000;
        }

        _guard = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _guard.Tick += (_, _) => VerifyAttachment();

        // At sign-in, Explorer often has not built the wallpaper layer yet. Rather than
        // give up and become a window, keep asking until it exists.
        _retry = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
        _retry.Tick += (_, _) => AttachToDesktop();

        Loaded += OnLoaded;
        Closing += (_, _) => ReleaseWeb();
    }

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

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);

        if (!IsWindowedMode) HideFromShell();
    }

    /// <summary>
    /// Keeps the window out of Alt+Tab and the taskbar while it is still trying to reach
    /// the desktop layer, so a slow attach never shows up as a stray window.
    /// </summary>
    private void HideFromShell()
    {
        long ex = GetWindowLong(_hwnd, GWL_EXSTYLE);
        ex &= ~WS_EX_APPWINDOW;
        ex |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(_hwnd, GWL_EXSTYLE, ex);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // Only WM_DISPLAYCHANGE forces a re-attach: a resolution or monitor change rebuilds
        // the WorkerW layer, so the old parent is stale. WM_SETTINGCHANGE deliberately does
        // NOT re-attach — it fires for countless unrelated events (including simply opening
        // our own console window), and reparenting on each one yanks the scene off the layer
        // mid-render, flashing the default wallpaper. The 4-second guard timer already
        // recovers a genuinely lost layer by checking the real parent, with no false hits.
        if (msg == WM_DISPLAYCHANGE)
        {
            DisplayChanged?.Invoke();
            if (_attached)
            {
                Dispatcher.BeginInvoke(() => AttachToDesktop(), DispatcherPriority.Background);
            }
        }
        return IntPtr.Zero;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync(_lifetime.Token);
            if (_lifetime.IsCancellationRequested) return;
        }
        catch (OperationCanceledException)
        {
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

        if (IsWindowedMode) CenterOnPrimary();
        else AttachToDesktop();
    }

    // ---------------------------------------------------------------- WebView2

    private async Task InitializeWebViewAsync(CancellationToken cancel)
    {
        await Web.EnsureCoreWebView2Async(_sharedEnvironment);
        cancel.ThrowIfCancellationRequested();

        var core = Web.CoreWebView2;
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 4, 6, 12);

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

        core.WebMessageReceived += OnWebMessage;

        // The scene folder is served over a reserved-by-RFC host name, so the page gets a
        // real origin (modules, fetch, and a secure context) without shipping a web server.
        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.DenyCors);

        // Nothing in this app should ever navigate away from the scene.
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        cancel.ThrowIfCancellationRequested();
        core.Navigate($"https://{VirtualHost}/index.html{_options.ToQueryString()}");
        Log.Write($"Scene served from {_webRoot}");
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("type", out var type)) return;

            switch (type.GetString())
            {
                case "ready":
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
                    Log.Write($"Scene error: {doc.RootElement.GetProperty("message").GetString()}");
                    break;
                case "announce":
                    Log.Write($"Switch {doc.RootElement.GetProperty("scene").GetString()} · {doc.RootElement.GetProperty("palette").GetString()}");
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Write("Bad web message", ex);
        }
    }

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

    private void AttachToDesktop()
    {
        if (IsWindowedMode) return;

        _attempts++;
        _layer = DesktopLayer.Find();
        _attached = DesktopLayer.Attach(_hwnd, _layer, out string failure);

        if (_attached)
        {
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

        // Fast for the first few seconds, then once every three.
        _retry.Interval = _attempts < 8 ? TimeSpan.FromMilliseconds(600) : TimeSpan.FromSeconds(3);
        _retry.Start();
    }

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

    private void ApplyWindowedChrome()
    {
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.CanResize;
        ShowInTaskbar = true;
    }

    private void CenterOnPrimary()
    {
        Left = (SystemParameters.PrimaryScreenWidth - Width) / 2;
        Top = (SystemParameters.PrimaryScreenHeight - Height) / 2;
    }

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

    internal void ReloadScene() => Web.CoreWebView2?.Reload();

    internal void OpenDevTools()
    {
        try
        {
            Web.CoreWebView2?.OpenDevToolsWindow();
        }
        catch (Exception ex)
        {
            Log.Write("DevTools unavailable", ex);
        }
    }

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
