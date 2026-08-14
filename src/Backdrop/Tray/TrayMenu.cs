using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Backdrop.Startup;
using Application = System.Windows.Application;

namespace Backdrop.Tray;

/// <summary>
/// The only visible chrome the app has. A wallpaper you cannot quit is a bug,
/// so this is created before anything else can go wrong.
/// </summary>
internal sealed class TrayMenu : IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly SceneHost _host;
    private NotifyIcon? _icon;
    private IntPtr _iconHandle;
    private ToolStripMenuItem? _modeItem;
    private ToolStripMenuItem? _layoutMenu;
    private ToolStripMenuItem? _singleItem;
    private ToolStripMenuItem? _spanItem;
    private ToolStripMenuItem? _duplicateItem;

    internal TrayMenu(SceneHost host) => _host = host;

    internal void Install()
    {
        var menu = new ContextMenuStrip { ShowImageMargin = false };

        _modeItem = new ToolStripMenuItem("Show in a window", null, (_, _) =>
        {
            _host.ToggleWindowedMode();
            RefreshModeLabel();
        });

        _singleItem = new ToolStripMenuItem("Single monitor", null, (_, _) => SetLayout(LayoutMode.Single));
        _spanItem = new ToolStripMenuItem("Span all monitors", null, (_, _) => SetLayout(LayoutMode.SpanAll));
        _duplicateItem = new ToolStripMenuItem("Duplicate on all monitors", null, (_, _) => SetLayout(LayoutMode.Duplicate));

        _layoutMenu = new ToolStripMenuItem("Desktop layout");
        _layoutMenu.DropDownItems.Add(_singleItem);
        _layoutMenu.DropDownItems.Add(_spanItem);
        _layoutMenu.DropDownItems.Add(_duplicateItem);

        menu.Items.Add(_modeItem);
        menu.Items.Add(_layoutMenu);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Reload scene", null, (_, _) => _host.ReloadScene()));
        menu.Items.Add(new ToolStripMenuItem("Open scene folder", null, (_, _) => _host.OpenSceneFolder()));
        menu.Items.Add(new ToolStripMenuItem("Open DevTools", null, (_, _) => _host.OpenDevTools()));
        menu.Items.Add(new ToolStripMenuItem("Open log", null, (_, _) => _host.OpenLog()));
        menu.Items.Add(new ToolStripMenuItem("Copy diagnostics", null, (_, _) => _host.CopyDiagnostics()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quit Backdrop", null, (_, _) => Application.Current.Shutdown()));
        menu.Items.Add(new ToolStripMenuItem("Kill Backdrop", null, (_, _) =>
        {
            try { Environment.Exit(1); }
            finally { System.Diagnostics.Process.GetCurrentProcess().Kill(); }
        }));

        _icon = new NotifyIcon
        {
            Icon = BuildIcon(),
            Text = "Backdrop",
            Visible = true,
            ContextMenuStrip = menu
        };

        _icon.DoubleClick += (_, _) =>
        {
            _host.ToggleWindowedMode();
            RefreshModeLabel();
        };

        RefreshModeLabel();
        RefreshLayoutLabel();
    }

    private void SetLayout(LayoutMode mode)
    {
        _host.SetLayoutMode(mode);
        RefreshLayoutLabel();
    }

    private void RefreshModeLabel()
    {
        if (_modeItem is null || _layoutMenu is null) return;
        _modeItem.Text = _host.IsWindowedMode ? "Put back on the desktop" : "Show in a window";
        _layoutMenu.Enabled = !_host.IsWindowedMode;
    }

    private void RefreshLayoutLabel()
    {
        if (_singleItem is null || _spanItem is null || _duplicateItem is null) return;
        _singleItem.Checked = _host.Mode == LayoutMode.Single;
        _spanItem.Checked = _host.Mode == LayoutMode.SpanAll;
        _duplicateItem.Checked = _host.Mode == LayoutMode.Duplicate;
    }

    /// <summary>Prefers the shipped app.ico; draws a fallback if it is missing.</summary>
    private Icon BuildIcon()
    {
        string shipped = Path.Combine(AppContext.BaseDirectory, "app.ico");
        if (File.Exists(shipped))
        {
            return new Icon(shipped);
        }

        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var sky = new LinearGradientBrush(new Rectangle(0, 0, 32, 32),
                       Color.FromArgb(255, 11, 34, 51), Color.FromArgb(255, 4, 6, 12), 90f))
            {
                g.FillRectangle(sky, 0, 0, 32, 32);
            }

            using var verdant = new Pen(Color.FromArgb(230, 53, 227, 160), 3f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            using var iris = new Pen(Color.FromArgb(190, 110, 91, 255), 2.5f) { StartCap = LineCap.Round, EndCap = LineCap.Round };

            g.DrawCurve(iris, new[] { new PointF(3, 18), new PointF(11, 8), new PointF(21, 15), new PointF(29, 6) }, 0.6f);
            g.DrawCurve(verdant, new[] { new PointF(3, 22), new PointF(12, 13), new PointF(22, 20), new PointF(29, 12) }, 0.6f);

            using var horizon = new Pen(Color.FromArgb(160, 207, 233, 255), 1.5f);
            g.DrawLine(horizon, 2, 26, 30, 26);
        }

        _iconHandle = bmp.GetHicon();
        return Icon.FromHandle(_iconHandle);
    }

    public void Dispose()
    {
        if (_icon is not null)
        {
            _icon.Visible = false;
            _icon.Dispose();
            _icon = null;
        }

        if (_iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
            _iconHandle = IntPtr.Zero;
        }

        Log.Write("Tray removed.");
    }
}
