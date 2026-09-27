// SceneHost.cs — the coordinator. One instance for the whole app, created by App.OnStartup.
// Job: stand up the single shared WebView2 environment, spawn one wallpaper window per
// target rectangle, keep that window set in sync with the physical monitors, and fan every
// command (hotkeys, tray clicks, console/comms messages) out to all of them at once.

using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Backdrop.DevLoop;
using Backdrop.Interop;
using Backdrop.Startup;
using Backdrop.Shell;
using Microsoft.Web.WebView2.Core;
using static Backdrop.Interop.NativeMethods;

// WinForms (tray) and WPF both define "Application"; pin every use here to the WPF one.
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

    // Every live wallpaper window. Index 0 is "the representative" — the one we read
    // WebRoot from and the one we parent the console/comms windows to. All of them
    // render the same scene from the same folder, so any window would do.
    private readonly List<MainWindow> _windows = new();

    private readonly ForegroundWatcher _foreground;
    private readonly Hotkey _hotkey;
    private readonly RebuildAndRelaunch _rebuild = new();
    private readonly DispatcherTimer _displayDebounce;

    // The ONE Chromium environment for the whole process. Every WebView2 across every
    // monitor is created from this — a second CoreWebView2Environment on the same
    // user-data folder throws, and sharing one also means one browser process instead
    // of N. Null until StartAsync has awaited CreateAsync.
    private CoreWebView2Environment? _environment;

    private ConsoleWindow? _console;   // settings panel, null when closed
    private CommsWindow? _comms;       // LLM chat overlay, null when closed
    private bool _rebuilding;          // true while CloseAllWindows tears the set down, so
                                       // OnWindowClosed doesn't mistake it for the last window closing

    // Current display state, exposed so TrayMenu can check/uncheck its menu items.
    // Both can change at runtime (tray toggles), which is why they're not readonly.
    internal bool IsWindowedMode { get; private set; }   // true = floating window, false = attached to desktop
    internal LayoutMode Mode { get; private set; }       // Single / SpanAll / Duplicate, only meaningful on the desktop

    internal SceneHost(CommandLineOptions options)
    {
        _options = options;
        IsWindowedMode = options.Windowed;

        // Layout depends on how many monitors are attached right now (e.g. SpanAll is
        // the default on a multi-monitor box, Single on a laptop). ResolveMode also
        // consults the saved tray pick and the CLI flags.
        Mode = options.ResolveMode(MonitorLayout.Screens().Count);

        // Poll the foreground window every 2s; when a maximized app or another wallpaper
        // fully covers the scene, pause rendering so we stop burning GPU on pixels nobody
        // can see. The scene resumes the moment it's uncovered.
        _foreground = new ForegroundWatcher(TimeSpan.FromSeconds(2));
        _foreground.CoveredChanged += covered => Broadcast(new { type = "visibility", paused = covered });

        // The low-level keyboard hook fires on a system thread — touching WPF from there
        // would crash — so every callback does nothing but BeginInvoke the real work onto
        // the UI thread. The five callbacks: Ctrl+Alt+B toggles the console, Win+[ /
        // Win+] / Win+P send a scene command, Win+Shift+- kicks the dev rebuild, Win+C
        // and the hardware Copilot key toggle comms, Win+Shift+U force-opens DevTools.
        _hotkey = new Hotkey(
            () => Application.Current.Dispatcher.BeginInvoke(ToggleConsole),
            cmd => Application.Current.Dispatcher.BeginInvoke(() => BroadcastSceneCommand(cmd)),
            () => Application.Current.Dispatcher.BeginInvoke(() => _rebuild.Trigger()),
            () => Application.Current.Dispatcher.BeginInvoke(ToggleComms),
            () => Application.Current.Dispatcher.BeginInvoke(() => OpenDevTools(force: true)));

        // One physical display change (plugging a monitor, a resolution switch) makes Windows
        // post WM_DISPLAYCHANGE to every top-level window, so with N wallpaper windows we get
        // N notifications for one event. This timer swallows the burst: each notification
        // restarts the 500ms countdown, and only when it finally expires do we reconcile once.
        _displayDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _displayDebounce.Tick += (_, _) =>
        {
            _displayDebounce.Stop();
            if (IsWindowedMode) return;   // a normal window follows the user, not the monitors
            // Duplicate mode has one window per monitor, so a monitor count change means
            // adding/removing windows — rebuild. Single/Span keep the same window(s) and
            // just move/resize them to the new geometry.
            if (Mode == LayoutMode.Duplicate) RebuildWindows();
            else RetargetExisting();
        };
    }

    /// <summary>
    /// One-time boot: create the shared browser environment, then build the window set.
    /// Called (and awaited) once from App.OnStartup.
    /// </summary>
    internal async Task StartAsync()
    {
        // Keep the browser profile under our log folder, not the default %LOCALAPPDATA%
        // spot, so a wipe of our data folder takes the WebView2 cache with it.
        string userData = Path.Combine(Log.Folder, "WebView2");
        Directory.CreateDirectory(userData);

        var envOptions = new CoreWebView2EnvironmentOptions
        {
            // A wallpaper window is never the foreground window, and Chromium aggressively
            // throttles anything it thinks is backgrounded or occluded — timers drop to 1Hz,
            // rAF stalls. The first three flags disable each throttle path so the scene keeps
            // animating at full rate behind the desktop. autoplay lets audio-reactive scenes
            // start their audio graph without a click; the log flags just keep Chromium quiet.
            AdditionalBrowserArguments = string.Join(' ',
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-logging",
                "--log-level=3")
        };

        // This is the only CreateAsync call in the app. Every MainWindow gets handed the
        // result and creates its WebView2 from it (see AddWindow).
        _environment = await CoreWebView2Environment.CreateAsync(null, userData, envOptions);

        // Dump the monitor layout to the log up front — the single most useful thing to
        // have when a bug report says "the wallpaper is on the wrong screen".
        var screens = MonitorLayout.Screens();
        Log.Write($"Layout {Mode} across {screens.Count} monitor(s)");
        for (int i = 0; i < screens.Count; i++)
        {
            var b = screens[i].Bounds;
            Log.Write($"  [{i}] {b.Width}x{b.Height} at {b.Left},{b.Top}" +
                      (screens[i].IsPrimary ? " (primary)" : string.Empty));
        }

        BuildWindows();

        // Start the singletons only after the windows exist, so their first callback
        // always finds a window to act on.
        _foreground.Start();
        _hotkey.Start();
    }

    // ------------------------------------------------------------- window set

    // Creates one window for each rectangle the current mode wants covered.
    private void BuildWindows()
    {
        foreach (var rect in TargetRects())
        {
            AddWindow(rect);
        }
    }

    // Spins up one wallpaper window over the given screen rect, wires its events back
    // to us, and shows it. Every window shares the one _environment.
    private void AddWindow(RECT bounds)
    {
        var window = new MainWindow(_options, bounds, _environment!, IsWindowedMode);
        window.DisplayChanged += OnAnyWindowDisplayChanged;   // funnels into the debounce timer
        window.SceneMessage += OnSceneMessage;                // scene-made config edits (shuffle etc.)
        window.Closed += (_, _) => OnWindowClosed(window);
        _windows.Add(window);
        window.Show();
    }

    // The set of screen rectangles the current mode wants a window on. This one method
    // encodes the whole layout policy; BuildWindows just iterates it.
    private IEnumerable<RECT> TargetRects()
    {
        if (IsWindowedMode)
        {
            // A normal resizable window — default RECT, WPF picks the size and position.
            yield return default;
            yield break;
        }

        if (Mode == LayoutMode.Duplicate)
        {
            // One window per physical monitor, each at that monitor's native bounds.
            var screens = MonitorLayout.Screens();
            if (screens.Count == 0)
            {
                // No monitors enumerated (RDP session, all displays asleep) — fall back
                // to the whole virtual desktop so we still put something up.
                yield return MonitorLayout.VirtualBounds;
                yield break;
            }
            foreach (var screen in screens) yield return screen.Bounds;
            yield break;
        }

        // Single or SpanAll: exactly one window. SpanAll -> the union of every monitor;
        // Single -> just the chosen monitor (or the primary if none was named).
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

    // Single/Span reconcile path: same number of windows as before, so just move each
    // one to its new rectangle (no page reload, no flash). If the count changed after
    // all — e.g. Span's union now spans a different set of monitors — fall back to a rebuild.
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

    // Tears the whole window set down. _rebuilding is held for the duration so the
    // per-window Closed handler doesn't read the emptying list as "user closed the
    // last window, time to quit". ReleaseWeb detaches each WebView2 from the shared
    // environment before the window closes, so the browser process stays healthy.
    private void CloseAllWindows()
    {
        _rebuilding = true;
        try
        {
            foreach (var window in _windows.ToArray())
            {
                window.DisplayChanged -= OnAnyWindowDisplayChanged;
                window.SceneMessage -= OnSceneMessage;
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

    // A window closed on its own (only really happens in windowed mode, where it has a
    // title bar and an X). If it was the last one and we're not mid-rebuild, the app
    // has nothing left to show — shut down.
    private void OnWindowClosed(MainWindow window)
    {
        window.DisplayChanged -= OnAnyWindowDisplayChanged;
        window.SceneMessage -= OnSceneMessage;
        _windows.Remove(window);
        if (!_rebuilding && IsWindowedMode && _windows.Count == 0)
            Application.Current.Shutdown();
    }

    // The scene changed its own config at runtime — today that means a palette shuffle
    // (Win+P, the dock's shuffle chip, or the panel's Shuffle button via the broadcast
    // path). Theme sync stays honest by (1) writing the new config to disk immediately,
    // so the choice survives a reload, and (2) broadcasting it to every OTHER monitor's
    // scene. Re-broadcasting to the sender too is harmless: its applyLive() is
    // idempotent for the config it just produced.
    private void OnSceneMessage(JsonElement config)
    {
        if (WriteConfig(config)) Log.Write("Config synced from scene.");
        Broadcast(new { type = "live", config = JsonElementToObject(config) });
    }

    private void OnAnyWindowDisplayChanged()
    {
        // Restart the debounce window on every event that lands inside it, so a burst of
        // near-simultaneous notifications collapses into exactly one reconcile.
        _displayDebounce.Stop();
        _displayDebounce.Start();
    }

    // ------------------------------------------------------------------- modes

    // Tray "Set as desktop background": only does anything if we're currently a
    // floating window — flip back to wallpaper mode.
    internal void SetDesktopBackground()
    {
        if (IsWindowedMode) ToggleWindowedMode();
    }

    // Swap between "attached behind the desktop icons" and "a normal resizable window".
    // Both directions do the same thing — close every window and rebuild — because the
    // window's HWND styling and desktop parenting are set at construction and can't be
    // toggled on a live window. The console is closed first; it's re-openable after.
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

    // Tray "Desktop layout" pick. Persist it (so it survives a relaunch) and, if we're
    // on the desktop right now, rebuild into the new layout immediately. In windowed
    // mode we just remember it for the next time desktop mode is entered.
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
    internal void OpenConsole()
    {
        // Called from the tray / --console, where "open" should never accidentally close
        // an already-open panel — just bring it forward. ToggleConsole is the hotkey path.
        if (_console is not null)
        {
            _console.Activate();
            return;
        }
        ToggleConsole();
    }

    // Ctrl+Alt+B: open the console if closed, close it if open.
    private void ToggleConsole()
    {
        if (_console is not null)
        {
            _console.Close();
            return;
        }

        if (_environment is null || _windows.Count == 0) return; // not up yet

        // The console is its own WebView2 window (an HTML settings UI). It's built from the
        // same shared environment and pointed at the same web folder as the scene, so its
        // relative asset paths resolve. Index-0 window is just our representative.
        _console = new ConsoleWindow(_windows[0].WebRoot, _options.DevTools, _environment);
        _console.Message += OnConsoleMessage;
        _console.Closed += (_, _) => _console = null;
        _console.Show();
        _console.Activate();
    }

    // Win+C or Ctrl+Alt+C: toggle the Comms overlay (the in-scene LLM chat window).
    // Same open-if-closed / close-if-open shape as the console.
    internal void ToggleComms()
    {
        if (_comms is not null)
        {
            Log.Write("Comms close");
            _comms.Close();
            return;
        }
        if (_environment is null || _windows.Count == 0)
        {
            Log.Write("Comms skipped — host not up yet");
            return;
        }

        try
        {
            _comms = new CommsWindow(_windows[0].WebRoot, _options.DevTools, _environment);
            _comms.Message += OnCommsMessage;
            _comms.Closed += (_, _) => _comms = null;
            _comms.Show();
            _comms.Activate();
            // Comms is a floating HUD the user summons over whatever's on screen, so force
            // it topmost explicitly — Activate alone loses the z-order race against a
            // full-screen app. Skip silently if the HWND isn't realized yet.
            IntPtr hwnd = new System.Windows.Interop.WindowInteropHelper(_comms).Handle;
            if (hwnd != IntPtr.Zero)
            {
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            }
            Log.Write("Comms open");
        }
        catch (Exception ex)
        {
            // Comms is optional chrome — if it fails to come up, log it, undo the partial
            // state, and leave the wallpaper running.
            Log.Write("Comms open failed", ex);
            try { _comms?.Close(); } catch { /* already gone */ }
            _comms = null;
        }
    }

    // Messages coming FROM the comms web UI. Every "type" is a verb the HTML sends over
    // the WebView2 host bridge. Chrome verbs (close, drag) act on the window; the llm-*
    // verbs run a network call on a background thread and post the result back with Send.
    private void OnCommsMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var type)) return;
        switch (type.GetString())
        {
            case "close":
                _comms?.Close();
                break;
            case "drag":
                // The overlay is borderless, so the HTML calls this on mousedown in its
                // title strip to hand dragging back to the OS window manager.
                _comms?.BeginDrag();
                break;
            case "comms-hello":
            {
                // The UI just finished loading and wants to populate its model picker and
                // status line. Fetch the model list off-thread, then marshal back to push
                // both messages into the (still-open) window.
                string webRoot = _windows[0].WebRoot;
                _ = Task.Run(async () =>
                {
                    var list = await LlmClient.ListModelsAsync(webRoot, CancellationToken.None);
                    var models = list.Models.Select(m => new { id = m.Id, kind = m.Kind }).ToArray();
                    Application.Current?.Dispatcher.BeginInvoke(() =>
                    {
                        _comms?.Send(new { type = "llm-models", models, current = list.Current, imageModel = list.ImageModel });
                        _comms?.Send(new { type = "llm-status", text = LlmClient.CarrierStatus(webRoot) });
                    });
                });
                break;
            }
            case "llm":
            {
                // A chat turn. Pull the fields out of the JSON (Clone the sub-elements —
                // the source document is freed once this handler returns), run the
                // completion off-thread, and post the reply back tagged with the same id
                // so the UI can match it to the pending message. Failures come back as
                // an error string in the same shape, never an exception.
                string id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                JsonElement messages = root.TryGetProperty("messages", out var m) ? m.Clone() : default;
                JsonElement files = root.TryGetProperty("files", out var f) ? f.Clone() : default;
                bool imagine = root.TryGetProperty("imagine", out var ig) && ig.ValueKind is JsonValueKind.True;
                string model = root.TryGetProperty("model", out var mo) ? mo.GetString() ?? "" : "";
                string webRoot = _windows[0].WebRoot;
                _ = Task.Run(async () =>
                {
                    LlmReply reply;
                    try { reply = await LlmClient.CompleteAsync(webRoot, messages, files, imagine, CancellationToken.None, model); }
                    catch (Exception ex)
                    {
                        Log.Write("LLM failed", ex);
                        reply = new LlmReply { Text = "UPLINK FAILED — " + ex.Message };
                    }
                    Application.Current?.Dispatcher.BeginInvoke(() =>
                        _comms?.Send(new { type = "llm-result", id, text = reply.Text, images = reply.Images }));
                });
                break;
            }
            case "llm-imagine":
            {
                // Dedicated image-generation turn (as opposed to "llm" with imagine=true).
                // Same off-thread + post-back-by-id pattern; the reply carries image data.
                string id = root.TryGetProperty("id", out var iid) ? iid.GetString() ?? "" : "";
                string prompt = root.TryGetProperty("prompt", out var pr) ? pr.GetString() ?? "" : "";
                string webRoot = _windows[0].WebRoot;
                _ = Task.Run(async () =>
                {
                    LlmReply reply;
                    try { reply = await LlmClient.ImagineAsync(webRoot, prompt, CancellationToken.None); }
                    catch (Exception ex)
                    {
                        Log.Write("image gen failed", ex);
                        reply = new LlmReply { Text = "IMAGE GEN FAILED — " + ex.Message };
                    }
                    Application.Current?.Dispatcher.BeginInvoke(() =>
                        _comms?.Send(new { type = "llm-result", id, text = reply.Text, images = reply.Images }));
                });
                break;
            }
            case "llm-upload":
            {
                string id = root.TryGetProperty("id", out var uid) ? uid.GetString() ?? "" : "";
                string name = root.TryGetProperty("name", out var nm) ? nm.GetString() ?? "upload.bin" : "upload.bin";
                string mime = root.TryGetProperty("mime", out var mi) ? mi.GetString() ?? "application/octet-stream" : "application/octet-stream";
                // A file attachment. The HTML base64-encodes the bytes into the message;
                // we decode, size-check, hand off to the carrier, and post back an id the
                // UI can reference in a later "llm" turn.
                string b64 = root.TryGetProperty("data", out var da) ? da.GetString() ?? "" : "";
                string webRoot = _windows[0].WebRoot;
                _ = Task.Run(async () =>
                {
                    object payload;
                    try
                    {
                        byte[] bytes = Convert.FromBase64String(b64);
                        if (bytes.Length > 8 * 1024 * 1024)   // guard: base64 in a web message is not the place for big files
                            payload = new { type = "llm-uploaded", id, error = "File over 8 MB." };
                        else
                        {
                            var up = await LlmClient.UploadAsync(webRoot, name, mime, bytes, CancellationToken.None);
                            payload = up is null
                                ? new { type = "llm-uploaded", id, error = "Upload failed." }
                                : (object)new { type = "llm-uploaded", id, file = new { id = up.Value.Id, name = up.Value.Name } };
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.Write("file upload failed", ex);
                        payload = new { type = "llm-uploaded", id, error = ex.Message };
                    }
                    Application.Current?.Dispatcher.BeginInvoke(() => _comms?.Send(payload));
                });
                break;
            }
        }
    }

    /// <summary>Routes a message from the console window to every scene and to disk.</summary>
    private void OnConsoleMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var type)) return;

        switch (type.GetString())
        {
            case "live":
                // A slider moved in the panel: push the new config to every scene right
                // now for a live preview, but don't touch disk. "savecfg" is what persists.
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
            // Re-roll only the sky dressing (stars, glow, motes). Same broadcast
            // shape as shuffle: every monitor re-rolls, and the scene sends the
            // resulting config back as a "live" edit which we persist.
            case "randomize":
                Broadcast(new { type = "randomize" });
                break;
            case "close":
                _console?.Close();
                break;
            case "host":
                // Everything that isn't a scene tweak — window mode, startup registration,
                // dev tools, quit — is nested under one "host" type with its own "action".
                HandleHostAction(root);
                break;
        }
    }

    // The second-level dispatch for console "host" messages. Each case is a button in the
    // panel's advanced section; most just forward to a tray-surface method or ShellIntegration.
    private void HandleHostAction(JsonElement root)
    {
        if (!root.TryGetProperty("action", out var action)) return;

        switch (action.GetString())
        {
            case "window":
                ToggleWindowedMode();
                break;
            case "desktop":
                SetDesktopBackground();
                break;
            case "startup-on":
                ShellIntegration.SetStartup(true);
                break;
            case "startup-off":
                ShellIntegration.SetStartup(false);
                break;
            case "windows-settings":
                ShellIntegration.OpenWindowsBackgroundSettings();
                break;
            case "screensaver-on":
                ShellIntegration.EnableScreensaver();
                break;
            case "register-shell":
                ShellIntegration.Register();
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
                OpenDevTools(force: true);
                break;
            case "log":
                OpenLog();
                break;
            case "diagnose":
                CopyDiagnostics();
                break;
            case "quit":
                // Graceful: runs OnExit, disposes the host, closes WebView2 cleanly.
                Application.Current.Shutdown();
                break;
            case "kill":
                // Panic button for when the graceful path is wedged (a hung renderer can
                // block shutdown). Exit(1) then a hard Kill of our own process — belt and
                // suspenders, since Exit can itself stall on a stuck finalizer.
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

    // The fan-out primitive. Every command in this class ends here: post the same web
    // message to each window's WebView2. In Single/Span there's one window; in Duplicate
    // this is what keeps all the monitors' scenes in lock-step.
    private void Broadcast(object payload)
    {
        foreach (var window in _windows) window.Send(payload);
    }

    // Hotkey scene commands (Win+[ "prev", Win+] "next", Win+P "shuffle") are just a bare
    // { type: cmd } message broadcast to every scene.
    private void BroadcastSceneCommand(string cmd) => Broadcast(new { type = cmd });

    // ----------------------------------------------------------- config I/O

    // There's one config.json, in the web folder, shared by every window — so we read and
    // write it once via the representative window, never per-window. Null when no
    // windows exist (early startup / mid-rebuild); every caller guards on it.
    private string? ConfigPath => _windows.Count == 0
        ? null
        : Path.Combine(_windows[0].WebRoot, "config.json");

    /// <summary>
    /// Persists the panel's edited config to disk exactly once (every window shares the same
    /// config.json), then reloads every window if the change needs a fresh page load.
    /// Route for the settings panel's Save button.
    /// </summary>
    private void SaveConfig(JsonElement root)
    {
        if (!root.TryGetProperty("config", out var config)) return;
        // Some settings (anything read only at page load) need a full reload to take;
        // the panel sets reload:true for those and relies on the live preview otherwise.
        bool reload = root.TryGetProperty("reload", out var r) && r.ValueKind == JsonValueKind.True;
        if (WriteConfig(config) && reload) ReloadScene();
    }

    /// <summary>
    /// The one place config.json is written. Pretty-prints so the file stays
    /// hand-editable, and keeps exactly one backup (config.json.bak) before every
    /// overwrite — that's what "resetcfg" restores from, and a safety net for a bad
    /// edit. Returns true when the file actually landed.
    /// </summary>
    private bool WriteConfig(JsonElement config)
    {
        string? path = ConfigPath;
        if (path is null) return false;
        try
        {
            string json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
            if (File.Exists(path)) File.Copy(path, path + ".bak", overwrite: true);
            File.WriteAllText(path, json);
            return true;
        }
        catch (Exception ex)
        {
            // A failed save must not take down the wallpaper — log and move on.
            Log.Write("Could not save config", ex);
            return false;
        }
    }

    /// <summary>
    /// The panel's Reset button. Two tiers: restore config.json from its .bak if one
    /// exists (undo the last Save); otherwise FACTORY RESET — delete config.json
    /// outright, which drops the scene back to config.js's FALLBACK defaults on the
    /// next load. Either way every window reloads so the change is visible.
    /// </summary>
    private void ResetConfig()
    {
        string? path = ConfigPath;
        if (path is null) return;
        try
        {
            string backup = path + ".bak";
            if (File.Exists(backup))
            {
                File.Copy(backup, path, overwrite: true);
                Log.Write("Config reset from backup.");
            }
            else if (File.Exists(path))
            {
                File.Delete(path);
                Log.Write("Config factory reset (no backup existed; scene falls back to defaults).");
            }
            else
            {
                Log.Write("Reset requested but no config or backup exists.");
                return;
            }
            ReloadScene();
        }
        catch (Exception ex)
        {
            Log.Write("Could not reset config", ex);
        }
    }

    // ------------------------------------------------------------- tray surface
    // These are the methods TrayMenu and the console call. They all delegate to a window
    // (usually the representative) or to Broadcast, so callers never touch the window list.

    /// <summary>
    /// Reloads the scene page in every window. Marshals to the UI thread first (tray
    /// callbacks arrive on a pool thread). If not one window could reload in place — its
    /// WebView2 is gone — fall back to tearing the set down and rebuilding it.
    /// </summary>
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

    // The rest just forward to the representative window — dev tools, "open scene folder"
    // in Explorer, "copy diagnostics" to the clipboard, "open log". FirstOrDefault so a
    // click during startup (no windows yet) is a harmless no-op.
    internal void OpenDevTools(bool force = false) => _windows.FirstOrDefault()?.OpenDevTools(force);

    internal void OpenSceneFolder() => _windows.FirstOrDefault()?.OpenSceneFolder();

    internal void CopyDiagnostics() => _windows.FirstOrDefault()?.CopyDiagnostics();

    internal void OpenLog() => _windows.FirstOrDefault()?.OpenLog();

    // Called from App.OnExit. Order matters: stop the timer and the singletons first so
    // nothing fires a callback into half-torn-down state, then close the child windows,
    // then the wallpaper windows. The shared _environment is left for the process to
    // reclaim — WebViewLifetime handles a leftover browser on the next run.
    public void Dispose()
    {
        _displayDebounce.Stop();
        _foreground.Dispose();
        _hotkey.Dispose();
        _console?.Close();
        CloseAllWindows();
    }
}
