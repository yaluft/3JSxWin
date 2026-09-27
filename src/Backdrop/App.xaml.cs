// App.xaml.cs — entry point. Runs before any window exists.
// Job: parse CLI, enforce single instance, set one env var, build SceneHost + tray.

using System.Windows;
using System.Windows.Threading;
using Backdrop.Interop;
using Backdrop.Startup;
using Backdrop.Tray;
using Backdrop.Shell;

// WinForms (tray icon) and WPF both define "Application", "MessageBox", etc.
// These aliases pin every use in this file to the WPF version.
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace Backdrop;

// "partial": other half is App.xaml. Build also generates a hidden Main().
public partial class App : Application
{
    // Named-mutex key for the "already running?" check. "Local\" = per-login-session.
    private const string InstanceMutexName = @"Local\Backdrop.SingleInstance";

    private Mutex? _instance;   // single-instance lock, held until process death
    private SceneHost? _host;   // owns the wallpaper window(s) + WebView2 + scene
    private TrayMenu? _tray;    // notification-area icon + right-click menu

    // WPF calls this once at boot. async because creating WebView2 is awaitable.
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Raw string[] args -> typed options (all flag parsing in CommandLineOptions).
        var options = CommandLineOptions.Parse(e.Args);

        // Screensaver "/p <hwnd>" preview: we don't draw the tiny preview box, just quit.
        if (options.ScreensaverPreview)
        {
            Shutdown();
            return;
        }

        // --help: no console on a WPF app, so show usage in a dialog then quit.
        if (options.ShowHelp)
        {
            MessageBox.Show(CommandLineOptions.Usage, "Backdrop", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // --diagnose: dump the shell's desktop-window tree (WorkerW etc). The
        // go-to tool when the wallpaper won't attach. Log it, show it, quit.
        if (options.Diagnose)
        {
            string report = DesktopLayer.Describe();
            Log.Write("Diagnostics:" + Environment.NewLine + report);
            MessageBox.Show(report, "Backdrop diagnostics", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // Single-instance guard via named mutex. isFirst == we created it.
        // Screensaver mode uses a separate mutex name so it can coexist with
        // a Backdrop already running as the wallpaper.
        string mutexName = options.ScreensaverRun ? InstanceMutexName + ".Screensaver" : InstanceMutexName;
        _instance = new Mutex(true, mutexName, out bool isFirst);
        if (!isFirst)
        {
            // Another copy owns the mutex. Tell the user where it is — unless
            // this is a quiet launch (shell/protocol/screensaver), then vanish.
            if (!options.QuietIfRunning)
            {
                MessageBox.Show("Backdrop is already running. Look for it in the notification area.",
                    "Backdrop", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            Shutdown();
            return;
        }

        // WebView2 paints white for the first frame or two. This env var makes
        // that paint opaque near-black instead. MUST be set before WebView2 starts.
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF04060C");

        // A crashed/killed previous run can leave msedgewebview2.exe holding the
        // user-data lock -> new environment throws ERROR_NOT_IN_CORRECT_STATE.
        // Kill any stragglers first.
        WebViewLifetime.ReapPrevious();

        // Two crash nets: UI-thread exceptions get logged and swallowed (app
        // keeps running); background-thread ones just get logged (process is
        // usually already dying).
        DispatcherUnhandledException += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Log.Write("Fatal", args.ExceptionObject as Exception ?? new Exception("unknown"));

        Log.Write($"--- start (windowed={options.Windowed}, monitor={options.MonitorIndex}) ---");

        try
        {
            // SceneHost: the heart of the app. Creates the WebView2 environment,
            // one MainWindow per monitor, attaches to the desktop, starts the scene.
            _host = new SceneHost(options);
            await _host.StartAsync();

            // Tray icon — the only way back once the window hides behind the desktop.
            _tray = new TrayMenu(_host);
            _tray.Install();

            // Registers "3jsxwin:" protocol, desktop menu entry, .theme assoc,
            // screensaver path. Idempotent — only writes missing/stale keys.
            ShellIntegration.Register();

            // --console / screensaver "/c": open settings once startup settles.
            if (options.OpenConsole)
            {
                _ = Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => _host.OpenConsole()));
            }
        }
        catch (Exception ex)
        {
            // Any boot failure is fatal: show message + log path, then quit.
            Log.Write("Startup failed", ex);
            MessageBox.Show(
                $"Backdrop could not start.\n\n{ex.Message}\n\nSee {Log.File}",
                "Backdrop", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    // Non-fatal UI-thread exception: log and swallow so the wallpaper keeps running.
    private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Write("Unhandled", e.Exception);
        e.Handled = true;
    }

    // Shutdown cleanup. NOT releasing _instance is deliberate: holding the mutex
    // until process death blocks a relaunch while Chromium is still tearing down.
    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _host?.Dispose();
        Log.Write("--- exit ---");
        base.OnExit(e);
    }
}
