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
    private const string VirtualHost = "backdrop.invalid";

    private readonly string _webRoot;
    private readonly bool _devTools;
    private readonly CoreWebView2Environment _environment;

    internal event Action<JsonElement>? Message;

    internal CommsWindow(string webRoot, bool devTools, CoreWebView2Environment environment)
    {
        _webRoot = webRoot;
        _devTools = devTools;
        _environment = environment;
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
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
        await Web.EnsureCoreWebView2Async(_environment);
        var core = Web.CoreWebView2;
        // WebView2 DefaultBackgroundColor only accepts alpha 0 or 255 (E_INVALIDARG otherwise).
        // Alpha 0 lets the transparent WPF window show through where the page is not painted.
        try { Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0, 11, 18, 32); }
        catch (Exception ex) { Log.Write("Comms DefaultBackgroundColor", ex); }

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
                Log.Write("Bad comms message", ex);
            }
        };

        core.SetVirtualHostNameToFolderMapping(VirtualHost, _webRoot, CoreWebView2HostResourceAccessKind.Allow);
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };
        core.Navigate($"https://{VirtualHost}/comms.html?v=8");
    }

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
    internal void BeginDrag()
    {
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, new IntPtr(HTCAPTION), IntPtr.Zero);
    }

    protected override void OnClosed(EventArgs e)
    {
        try { Web?.Dispose(); }
        catch (Exception ex) { Log.Write("Comms WebView2 release", ex); }
        base.OnClosed(e);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // WindowStyle=None normally drops the taskbar button; force it back on so Comms
        // gets its own taskbar entry (ShowInTaskbar alone is not honoured for a chromeless window).
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        long ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        ex |= WS_EX_APPWINDOW;
        ex &= ~WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    }
}
