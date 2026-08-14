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
    private const string VirtualHost = "backdrop.invalid";

    private readonly string _webRoot;
    private readonly bool _devTools;
    private readonly CoreWebView2Environment _environment;

    /// <summary>Raised with each web message from the console page (already JSON-parsed).</summary>
    internal event Action<JsonElement>? Message;

    internal ConsoleWindow(string webRoot, bool devTools, CoreWebView2Environment environment)
    {
        _webRoot = webRoot;
        _devTools = devTools;
        _environment = environment;
        InitializeComponent();
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
            Log.Write("Console WebView2 init failed", ex);
            Close();
        }
    }

    /// <summary>Opens the console near the top-right of the primary work area.</summary>
    private void PlaceTopRight()
    {
        var wa = SystemParameters.WorkArea;
        Left = wa.Right - Width - 32;
        Top = wa.Top + 32;
    }

    private async Task InitializeWebViewAsync()
    {
        // Reuse the scene's environment — a second environment on the same user-data folder
        // fails with ERROR_NOT_IN_CORRECT_STATE. One environment can back many controllers.
        await Web.EnsureCoreWebView2Async(_environment);

        var core = Web.CoreWebView2;

        // Opaque, dark. A transparent WebView2 inside an AllowsTransparency WPF window is
        // the classic airspace trap — the control goes non-interactive because an HWND-based
        // WebView2 can't composite into a layered window. Solid background keeps clicks live.
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 4, 6, 12);

        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = _devTools;
        s.AreDevToolsEnabled = _devTools;
        s.AreBrowserAcceleratorKeysEnabled = _devTools;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;

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

        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.DenyCors);
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        core.Navigate($"https://{VirtualHost}/console.html");
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        // Keep the console off Alt+Tab and the taskbar; it is a tool, not an app window.
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        long ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        ex &= ~WS_EX_APPWINDOW;
        ex |= WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    }
}
