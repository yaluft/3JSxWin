using System.Windows;
using System.Windows.Threading;
using Backdrop.Interop;
using Backdrop.Startup;
using Backdrop.Tray;

// WinForms is referenced for the tray icon, and it brings its own Application type.
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace Backdrop;

public partial class App : Application
{
    private const string InstanceMutexName = @"Local\Backdrop.SingleInstance";

    private Mutex? _instance;
    private SceneHost? _host;
    private TrayMenu? _tray;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var options = CommandLineOptions.Parse(e.Args);

        if (options.ShowHelp)
        {
            MessageBox.Show(CommandLineOptions.Usage, "Backdrop", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        if (options.Diagnose)
        {
            string report = DesktopLayer.Describe();
            Log.Write("Diagnostics:" + Environment.NewLine + report);
            MessageBox.Show(report, "Backdrop diagnostics", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        _instance = new Mutex(true, InstanceMutexName, out bool isFirst);
        if (!isFirst)
        {
            MessageBox.Show("Backdrop is already running. Look for it in the notification area.",
                "Backdrop", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // Kills the white flash while the renderer spins up. Must be set before the
        // WebView2 environment is created.
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF04060C");

        // A previous instance (or tray Kill) can leave msedgewebview2 holding
        // Chrome_WidgetWin_0. Reap it before we create another environment.
        WebViewLifetime.ReapPrevious();

        DispatcherUnhandledException += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Log.Write("Fatal", args.ExceptionObject as Exception ?? new Exception("unknown"));

        Log.Write($"--- start (windowed={options.Windowed}, monitor={options.MonitorIndex}) ---");

        try
        {
            _host = new SceneHost(options);
            await _host.StartAsync();
            _tray = new TrayMenu(_host);
            _tray.Install();
        }
        catch (Exception ex)
        {
            Log.Write("Startup failed", ex);
            MessageBox.Show(
                $"Backdrop could not start.\n\n{ex.Message}\n\nSee {Log.File}",
                "Backdrop", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Write("Unhandled", e.Exception);
        e.Handled = true;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _host?.Dispose();
        // Leave the mutex held until process death so a relaunch cannot start
        // while Chromium is still tearing down Chrome_WidgetWin_0.
        Log.Write("--- exit ---");
        base.OnExit(e);
    }
}
