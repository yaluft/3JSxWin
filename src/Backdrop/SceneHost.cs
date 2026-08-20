using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Backdrop.DevLoop;
using Backdrop.Interop;
using Backdrop.Startup;
using Microsoft.Web.WebView2.Core;
using static Backdrop.Interop.NativeMethods;

using Application = System.Windows.Application;

namespace Backdrop;

/// <summary>
/// Owns every MainWindow in the app (one in Single/Span mode, one per monitor in Duplicate
/// mode), plus everything that must be a singleton regardless of window count: the global
/// Hotkey hook, the one CoreWebView2Environment, the on-scene console, and the foreground
/// watcher. TrayMenu talks to this instead of to a single MainWindow.
/// </summary>
internal sealed class SceneHost : IDisposable
{
    private readonly CommandLineOptions _options;
    private readonly List<MainWindow> _windows = new();
    private readonly ForegroundWatcher _foreground;
    private readonly Hotkey _hotkey;
    private readonly RebuildAndRelaunch _rebuild = new();
    private readonly DispatcherTimer _displayDebounce;

    private CoreWebView2Environment? _environment;
    private ConsoleWindow? _console;
    private bool _rebuilding;

    internal bool IsWindowedMode { get; private set; }
    internal LayoutMode Mode { get; private set; }

    internal SceneHost(CommandLineOptions options)
    {
        _options = options;
        IsWindowedMode = options.Windowed;
        Mode = options.ResolveMode(MonitorLayout.Screens().Count);

        _foreground = new ForegroundWatcher(TimeSpan.FromSeconds(2));
        _foreground.CoveredChanged += covered => Broadcast(new { type = "visibility", paused = covered });

        // The hook fires on a system thread; every callback bounces onto the UI thread
        // before touching any window or WPF state.
        _hotkey = new Hotkey(
            () => Application.Current.Dispatcher.BeginInvoke(ToggleConsole),
            cmd => Application.Current.Dispatcher.BeginInvoke(() => BroadcastSceneCommand(cmd)),
            () => Application.Current.Dispatcher.BeginInvoke(() => _rebuild.Trigger()));

        // Coalesces the burst of DisplayChanged events every window in the group raises for
        // the same physical event into one reconcile pass.
        _displayDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _displayDebounce.Tick += (_, _) =>
        {
            _displayDebounce.Stop();
            if (IsWindowedMode) return;
            if (Mode == LayoutMode.Duplicate) RebuildWindows();
            else RetargetExisting();
        };
    }

    internal async Task StartAsync()
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
                "--disable-renderer-backgrounding",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-logging",
                "--log-level=3")
        };

        _environment = await CoreWebView2Environment.CreateAsync(null, userData, envOptions);

        var screens = MonitorLayout.Screens();
        Log.Write($"Layout {Mode} across {screens.Count} monitor(s)");
        for (int i = 0; i < screens.Count; i++)
        {
            var b = screens[i].Bounds;
            Log.Write($"  [{i}] {b.Width}x{b.Height} at {b.Left},{b.Top}" +
                      (screens[i].IsPrimary ? " (primary)" : string.Empty));
        }

        BuildWindows();

        _foreground.Start();
        _hotkey.Start();
    }

    // ------------------------------------------------------------- window set

    private void BuildWindows()
    {
        foreach (var rect in TargetRects())
        {
            AddWindow(rect);
        }
    }

    private void AddWindow(RECT bounds)
    {
        var window = new MainWindow(_options, bounds, _environment!, IsWindowedMode);
        window.DisplayChanged += OnAnyWindowDisplayChanged;
        window.Closed += (_, _) => OnWindowClosed(window);
        _windows.Add(window);
        window.Show();
    }

    private IEnumerable<RECT> TargetRects()
    {
        if (IsWindowedMode)
        {
            yield return default;
            yield break;
        }

        if (Mode == LayoutMode.Duplicate)
        {
            var screens = MonitorLayout.Screens();
            if (screens.Count == 0)
            {
                yield return MonitorLayout.VirtualBounds;
                yield break;
            }
            foreach (var screen in screens) yield return screen.Bounds;
            yield break;
        }

        yield return MonitorLayout.TargetBounds(Mode == LayoutMode.SpanAll, _options.MonitorIndex);
    }

    /// <summary>Closes every window and rebuilds the set from scratch for the current mode.
    /// Used both for explicit mode switches and for reacting to a monitor being added or
    /// removed while in Duplicate mode — simpler and far fewer edge cases than diffing the
    /// window set incrementally, at the cost of a brief flash on the rare display change.</summary>
    private void RebuildWindows()
    {
        CloseAllWindows();
        BuildWindows();
    }

    private void RetargetExisting()
    {
        var rects = TargetRects().ToList();
        if (rects.Count != _windows.Count)
        {
            RebuildWindows();
            return;
        }
        for (int i = 0; i < rects.Count; i++) _windows[i].Retarget(rects[i]);
    }

    private void CloseAllWindows()
    {
        _rebuilding = true;
        try
        {
            foreach (var window in _windows.ToArray())
            {
                window.DisplayChanged -= OnAnyWindowDisplayChanged;
                window.ReleaseWeb();
                window.Close();
            }
            _windows.Clear();
        }
        finally
        {
            _rebuilding = false;
        }
    }

    private void OnWindowClosed(MainWindow window)
    {
        window.DisplayChanged -= OnAnyWindowDisplayChanged;
        _windows.Remove(window);
        if (!_rebuilding && IsWindowedMode && _windows.Count == 0)
            Application.Current.Shutdown();
    }

    private void OnAnyWindowDisplayChanged()
    {
        // Restart the debounce window on every event that lands inside it, so a burst of
        // near-simultaneous notifications collapses into exactly one reconcile.
        _displayDebounce.Stop();
        _displayDebounce.Start();
    }

    // ------------------------------------------------------------------- modes

    internal void ToggleWindowedMode()
    {
        _console?.Close();

        if (IsWindowedMode)
        {
            IsWindowedMode = false;
            CloseAllWindows();
            BuildWindows();
        }
        else
        {
            IsWindowedMode = true;
            CloseAllWindows();
            BuildWindows();
        }
    }

    internal void SetLayoutMode(LayoutMode mode)
    {
        if (mode == Mode) return;
        Mode = mode;
        DesktopLayoutSettings.Save(mode);
        if (IsWindowedMode) return; // takes effect next time desktop mode is entered

        _console?.Close();
        RebuildWindows();
    }

    // ---------------------------------------------------------------- console

    /// <summary>
    /// Opens the control console in its own small window, or closes it if already open. Its
    /// messages fan out to every window in the group, since every monitor shares one scene
    /// and one config.
    /// </summary>
    private void ToggleConsole()
    {
        if (_console is not null)
        {
            _console.Close();
            return;
        }

        if (_environment is null || _windows.Count == 0) return; // not up yet

        _console = new ConsoleWindow(_windows[0].WebRoot, _options.DevTools, _environment);
        _console.Message += OnConsoleMessage;
        _console.Closed += (_, _) => _console = null;
        _console.Show();
        _console.Activate();
    }

    /// <summary>Routes a message from the console window to every scene and to disk.</summary>
    private void OnConsoleMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var type)) return;

        switch (type.GetString())
        {
            case "live":
                if (root.TryGetProperty("config", out var cfg))
                    Broadcast(new { type = "live", config = JsonElementToObject(cfg) });
                break;
            case "savecfg":
                SaveConfig(root);
                break;
            case "resetcfg":
                ResetConfig();
                break;
            case "shuffle":
                Broadcast(new { type = "shuffle" });
                break;
            case "close":
                _console?.Close();
                break;
            case "host":
                HandleHostAction(root);
                break;
        }
    }

    private void HandleHostAction(JsonElement root)
    {
        if (!root.TryGetProperty("action", out var action)) return;

        switch (action.GetString())
        {
            case "window":
                ToggleWindowedMode();
                break;
            case "layout-single":
                SetLayoutMode(LayoutMode.Single);
                break;
            case "layout-span":
                SetLayoutMode(LayoutMode.SpanAll);
                break;
            case "layout-duplicate":
                SetLayoutMode(LayoutMode.Duplicate);
                break;
            case "reload":
                ReloadScene();
                break;
            case "folder":
                OpenSceneFolder();
                break;
            case "devtools":
                OpenDevTools();
                break;
            case "log":
                OpenLog();
                break;
            case "diagnose":
                CopyDiagnostics();
                break;
            case "quit":
                Application.Current.Shutdown();
                break;
            case "kill":
                try { Environment.Exit(1); }
                finally { System.Diagnostics.Process.GetCurrentProcess().Kill(); }
                break;
        }
    }

    /// <summary>
    /// Forwards a parsed config element to the scene verbatim. Serializing the JsonElement
    /// straight back into the web message keeps the exact shape the console sent.
    /// </summary>
    private static object JsonElementToObject(JsonElement element) =>
        JsonSerializer.Deserialize<object>(element.GetRawText())!;

    private void Broadcast(object payload)
    {
        foreach (var window in _windows) window.Send(payload);
    }

    private void BroadcastSceneCommand(string cmd) => Broadcast(new { type = cmd });

    // ----------------------------------------------------------- config I/O

    private string ConfigPath => Path.Combine(_windows[0].WebRoot, "config.json");

    /// <summary>
    /// Persists the panel's edited config to disk exactly once (every window shares the same
    /// config.json), then reloads every window if the change needs a fresh page load.
    /// </summary>
    private void SaveConfig(JsonElement root)
    {
        if (_windows.Count == 0) return;
        try
        {
            if (!root.TryGetProperty("config", out var config)) return;

            string json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });

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

    /// <summary>Restores config.json from its backup, then reloads every window.</summary>
    private void ResetConfig()
    {
        if (_windows.Count == 0) return;
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

    // ------------------------------------------------------------- tray surface

    internal void ReloadScene()
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is not null && !dispatcher.CheckAccess())
        {
            dispatcher.BeginInvoke(ReloadScene);
            return;
        }

        var windows = _windows.ToArray();
        if (windows.Length == 0) return;
        bool any = false;
        foreach (var window in windows) any |= window.TryReloadScene();
        if (any) return;
        Log.Write("Reload failed; rebuilding windows.");
        RebuildWindows();
    }

    internal void OpenDevTools() => _windows.FirstOrDefault()?.OpenDevTools();

    internal void OpenSceneFolder() => _windows.FirstOrDefault()?.OpenSceneFolder();

    internal void CopyDiagnostics() => _windows.FirstOrDefault()?.CopyDiagnostics();

    internal void OpenLog() => _windows.FirstOrDefault()?.OpenLog();

    public void Dispose()
    {
        _displayDebounce.Stop();
        _foreground.Dispose();
        _hotkey.Dispose();
        _console?.Close();
        CloseAllWindows();
    }
}
