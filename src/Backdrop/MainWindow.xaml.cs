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
    private readonly ForegroundWatcher _foreground;
    private readonly Hotkey _hotkey;
    private int _attempts;

    private IntPtr _hwnd;
    private LayerResult _layer;
    private bool _attached;
    private bool _ready;
    private ConsoleWindow? _console;
    private CoreWebView2Environment? _environment;

    internal bool IsWindowedMode { get; private set; }

    internal MainWindow(CommandLineOptions options)
    {
        _options = options;
        IsWindowedMode = options.Windowed;

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

        _foreground = new ForegroundWatcher(TimeSpan.FromSeconds(2));
        _foreground.CoveredChanged += covered => Send(new { type = "visibility", paused = covered });

        // Tap Ctrl+Alt+B to toggle the console window open/closed. The hook fires on a
        // system thread, so bounce the toggle onto the UI thread.
        _hotkey = new Hotkey(() =>
            Dispatcher.BeginInvoke(ToggleConsole));

        Loaded += OnLoaded;
        Closed += OnClosed;
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
        if (msg == WM_DISPLAYCHANGE && _attached)
        {
            Dispatcher.BeginInvoke(() => AttachToDesktop(), DispatcherPriority.Background);
        }
        return IntPtr.Zero;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
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

        _foreground.Start();
        _hotkey.Start();
    }

    // ---------------------------------------------------------------- WebView2

    private async Task InitializeWebViewAsync()
    {
        string userData = Path.Combine(Log.Folder, "WebView2");
        Directory.CreateDirectory(userData);

        var envOptions = new CoreWebView2EnvironmentOptions
        {
            // A backdrop is never the focused window, and Chromium throttles those hard.
            // These three flags keep requestAnimationFrame running at full rate.
            AdditionalBrowserArguments = string.Join(' ',
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding")
        };

        // One environment for the whole app. The console window reuses this instance rather
        // than creating its own — a second environment on the same user-data folder throws
        // ERROR_NOT_IN_CORRECT_STATE (0x8007139F).
        _environment = await CoreWebView2Environment.CreateAsync(null, userData, envOptions);
        await Web.EnsureCoreWebView2Async(_environment);

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
                    break;
                case "error":
                    Log.Write($"Scene error: {doc.RootElement.GetProperty("message").GetString()}");
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Write("Bad web message", ex);
        }
    }

    private void Send(object payload)
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

    // ---------------------------------------------------------------- console

    /// <summary>
    /// Opens the control console in its own small window, or closes it if already open. The
    /// scene itself is never touched — it keeps rendering behind the icons — so the desktop,
    /// taskbar, and apps stay visible while you tune it.
    /// </summary>
    private void ToggleConsole()
    {
        if (_console is not null)
        {
            _console.Close();
            return;
        }

        if (_environment is null) return; // WebView2 not up yet

        _console = new ConsoleWindow(_webRoot, _options.DevTools, _environment);
        _console.Message += OnConsoleMessage;
        _console.Closed += (_, _) => _console = null;
        _console.Show();
        _console.Activate();
    }

    /// <summary>Routes a message from the console window to the scene and to disk.</summary>
    private void OnConsoleMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var type)) return;

        switch (type.GetString())
        {
            case "live":
                // Relay the edited config to the scene page to apply live, no reload.
                if (root.TryGetProperty("config", out var cfg))
                    Send(new { type = "live", config = JsonElementToObject(cfg) });
                break;
            case "savecfg":
                SaveConfig(root);
                break;
            case "resetcfg":
                ResetConfig();
                break;
            case "close":
                _console?.Close();
                break;
        }
    }

    /// <summary>
    /// Forwards a parsed config element to the scene verbatim. Serializing the JsonElement
    /// straight back into the web message keeps the exact shape the console sent.
    /// </summary>
    private static object JsonElementToObject(JsonElement element) =>
        JsonSerializer.Deserialize<object>(element.GetRawText())!;

    // ----------------------------------------------------------- config I/O

    private string ConfigPath => Path.Combine(_webRoot, "config.json");

    /// <summary>
    /// Persists the panel's edited config to disk. The scene has already applied the visual
    /// changes live; this just makes them survive a reload. Settings the running scene cannot
    /// change in place (mote count, clock) come with reload=true, so we refresh after writing.
    /// </summary>
    private void SaveConfig(JsonElement root)
    {
        try
        {
            if (!root.TryGetProperty("config", out var config)) return;

            // Pretty-print so the file stays hand-editable, matching how it ships.
            string json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });

            // Keep one backup so a bad edit is never a lost config.
            if (File.Exists(ConfigPath)) File.Copy(ConfigPath, ConfigPath + ".bak", overwrite: true);
            File.WriteAllText(ConfigPath, json);
            Log.Write("Config saved from panel.");

            if (root.TryGetProperty("reload", out var reload) && reload.ValueKind == JsonValueKind.True)
            {
                ReloadScene();
            }
        }
        catch (Exception ex)
        {
            Log.Write("Could not save config", ex);
        }
    }

    /// <summary>Restores config.json from its backup, then reloads the scene.</summary>
    private void ResetConfig()
    {
        try
        {
            string backup = ConfigPath + ".bak";
            if (File.Exists(backup))
            {
                File.Copy(backup, ConfigPath, overwrite: true);
                Log.Write("Config reset from backup.");
                ReloadScene();
            }
            else
            {
                Log.Write("Reset requested but no config backup exists.");
            }
        }
        catch (Exception ex)
        {
            Log.Write("Could not reset config", ex);
        }
    }

    private void ApplyBounds()
    {
        RECT target = MonitorLayout.TargetBounds(_options.SpanAll, _options.MonitorIndex);

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

        // Close the console so it never survives a mode change.
        _console?.Close();

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

    internal void ToggleMode()
    {
        if (IsWindowedMode) SwitchToDesktop();
        else SwitchToWindowed();
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

    private void OnClosed(object? sender, EventArgs e)
    {
        _guard.Stop();
        _retry.Stop();
        _foreground.Dispose();
        _hotkey.Dispose();
        _console?.Close();
        Web?.Dispose();
    }
}
