// TrayMenu.cs — the notification-area icon and its right-click menu.
// Once the scene is living behind the desktop icons there is no window to click,
// so this tray icon is the entire UI: every mode switch, every diagnostic, and
// the way out. It is a thin shell — every item just calls a SceneHost method.

// We deliberately use WinForms' NotifyIcon + ContextMenuStrip here even though the
// rest of the app is WPF: WPF has no built-in tray-icon type, and NotifyIcon is
// the battle-tested Win32 Shell_NotifyIcon wrapper. The `Application =` alias below
// keeps the one WPF reference in this file (Shutdown) from colliding with
// System.Windows.Forms.Application.
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Backdrop.Startup;
using Backdrop.Shell;
using Application = System.Windows.Application;

namespace Backdrop.Tray;

/// <summary>
/// The only visible chrome the app has. A wallpaper you cannot quit is a bug,
/// so this is created before anything else can go wrong.
/// </summary>
internal sealed class TrayMenu : IDisposable
{
    // DestroyIcon frees an HICON created by Bitmap.GetHicon(). GDI icon handles are
    // not garbage-collected, so a fallback icon we drew ourselves would leak one
    // handle per run without this. Only needed for the drawn fallback — an Icon
    // loaded from app.ico owns its own handle and cleans up on Dispose().
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly SceneHost _host;
    private NotifyIcon? _icon;
    private IntPtr _iconHandle;
    // We hold references to the items whose text or checkmark changes at runtime so
    // Refresh*Label() can reach back in and update them. Items that never change
    // (Reload scene, Open log, ...) are added inline and then forgotten.
    private ToolStripMenuItem? _modeItem;
    private ToolStripMenuItem? _layoutMenu;
    private ToolStripMenuItem? _singleItem;
    private ToolStripMenuItem? _spanItem;
    private ToolStripMenuItem? _duplicateItem;

    internal TrayMenu(SceneHost host) => _host = host;

    internal void Install()
    {
        // ShowImageMargin = false drops the empty icon gutter on the left of the menu,
        // since none of our items carry an image — it just looks tighter.
        var menu = new ContextMenuStrip { ShowImageMargin = false };

        // "Show in a window" / "Put back on the desktop" — the headline toggle.
        // SceneHost.ToggleWindowedMode() tears down the WorkerW-attached window(s)
        // and rebuilds them as a normal resizable window, or vice versa. We refresh
        // the label right after because the same item flips its own text.
        _modeItem = new ToolStripMenuItem("Show in a window", null, (_, _) =>
        {
            _host.ToggleWindowedMode();
            RefreshModeLabel();
        });

        // "Desktop layout" submenu — how the scene covers multiple monitors.
        // Each item calls SceneHost.SetLayoutMode() (via SetLayout below), which also
        // persists the pick to layout.txt so the next launch remembers it.
        //   Single    = one window on one monitor
        //   SpanAll   = one window stretched across the whole virtual desktop
        //   Duplicate = a separate window + WebView2 per monitor
        _singleItem = new ToolStripMenuItem("Single monitor", null, (_, _) => SetLayout(LayoutMode.Single));
        _spanItem = new ToolStripMenuItem("Span all monitors", null, (_, _) => SetLayout(LayoutMode.SpanAll));
        _duplicateItem = new ToolStripMenuItem("Duplicate on all monitors", null, (_, _) => SetLayout(LayoutMode.Duplicate));

        _layoutMenu = new ToolStripMenuItem("Desktop layout");
        _layoutMenu.DropDownItems.Add(_singleItem);
        _layoutMenu.DropDownItems.Add(_spanItem);
        _layoutMenu.DropDownItems.Add(_duplicateItem);

        // "Start with Windows" — toggles a shortcut in the shell:Startup folder.
        // We read the current state, flip it, and write it back. The checkmark is
        // NOT set here; it is set every time the menu opens (see menu.Opening below)
        // so it stays honest even if the user deletes the shortcut by hand.
        var startupItem = new ToolStripMenuItem("Start with Windows", null, (_, _) =>
        {
            bool next = !ShellIntegration.IsStartupEnabled();
            ShellIntegration.SetStartup(next);
        });
        // IsStartupEnabled() just checks whether Backdrop.lnk exists in the Startup
        // folder — cheap enough to re-check on every menu open.
        menu.Opening += (_, _) => { startupItem.Checked = ShellIntegration.IsStartupEnabled(); };

        menu.Items.Add(_modeItem);
        menu.Items.Add(_layoutMenu);
        menu.Items.Add(startupItem);
        // Opens Settings → Personalization → Background via the ms-settings: URI —
        // a courtesy link, since Backdrop can't register itself as a real background type.
        menu.Items.Add(new ToolStripMenuItem("Windows background settings", null, (_, _) =>
            ShellIntegration.OpenWindowsBackgroundSettings()));
        menu.Items.Add(new ToolStripSeparator());
        // Scene / diagnostics block. Each of these delegates to the first MainWindow
        // via SceneHost, since every window in the group shares one scene folder.
        //   Reload scene     — re-navigates the WebView2 to the scene (picks up edited files)
        //   Open scene folder — Explorer at the web/ directory you'd edit
        //   Open DevTools    — Chromium DevTools for the live scene
        //   Open log         — the rolling text log this app writes
        //   Copy diagnostics — dumps the desktop-window tree + config to the clipboard
        menu.Items.Add(new ToolStripMenuItem("Reload scene", null, (_, _) => _host.ReloadScene()));
        menu.Items.Add(new ToolStripMenuItem("Open scene folder", null, (_, _) => _host.OpenSceneFolder()));
        // Explicit tray click always forces: DevTools from the tray is an intentional
        // developer action, same as the Win+Shift+U chord.
        menu.Items.Add(new ToolStripMenuItem("Open DevTools (Win+Shift+U)", null, (_, _) => _host.OpenDevTools(force: true)));
        menu.Items.Add(new ToolStripMenuItem("Open log", null, (_, _) => _host.OpenLog()));
        menu.Items.Add(new ToolStripMenuItem("Copy diagnostics", null, (_, _) => _host.CopyDiagnostics()));
        menu.Items.Add(new ToolStripSeparator());
        // "Open Comms" — toggles the floating chat/LLM window. The tray's click event
        // fires on the WinForms UI thread, but CommsWindow is WPF, so we hop onto the
        // WPF Dispatcher before touching it. CheckAccess() short-circuits the hop when
        // we happen to already be on that thread.
        menu.Items.Add(new ToolStripMenuItem("Open Comms (Win+C / Ctrl+Alt+C)", null, (_, _) =>
        {
            var d = Application.Current?.Dispatcher;
            if (d is null || d.CheckAccess()) _host.ToggleComms();
            else d.BeginInvoke(() => _host.ToggleComms());
        }));
        menu.Items.Add(new ToolStripSeparator());
        // Two ways out. "Quit" is the clean path — Application.Shutdown() runs
        // OnExit, disposes the host, lets Chromium tear down in order.
        menu.Items.Add(new ToolStripMenuItem("Quit Backdrop", null, (_, _) => Application.Current.Shutdown()));
        // "Kill" is the panic button for when the scene has wedged the UI thread and
        // a clean shutdown would hang: Environment.Exit then Process.Kill, no cleanup.
        // The finally block guarantees the Kill runs even if Exit somehow returns.
        menu.Items.Add(new ToolStripMenuItem("Kill Backdrop", null, (_, _) =>
        {
            try { Environment.Exit(1); }
            finally { System.Diagnostics.Process.GetCurrentProcess().Kill(); }
        }));

        // Visible = true is what actually adds the icon to the notification area.
        // Text is the hover tooltip. ContextMenuStrip wires the right-click menu.
        _icon = new NotifyIcon
        {
            Icon = BuildIcon(),
            Text = "Backdrop",
            Visible = true,
            ContextMenuStrip = menu
        };

        // Double-clicking the tray icon is a shortcut for the headline toggle —
        // same as picking "Show in a window" / "Put back on the desktop" from the menu.
        _icon.DoubleClick += (_, _) =>
        {
            _host.ToggleWindowedMode();
            RefreshModeLabel();
        };

        // Prime the dynamic labels/checkmarks to match the state we booted into.
        RefreshModeLabel();
        RefreshLayoutLabel();
    }

    // Apply a layout pick and immediately re-tick the checkmarks. SetLayoutMode
    // rebuilds the windows (in desktop mode) and saves the choice to disk.
    private void SetLayout(LayoutMode mode)
    {
        _host.SetLayoutMode(mode);
        RefreshLayoutLabel();
    }

    // Keeps the headline toggle's text in sync with which mode we're in, and greys
    // out the "Desktop layout" submenu while windowed — layout only means something
    // when the scene is actually attached to the desktop.
    private void RefreshModeLabel()
    {
        if (_modeItem is null || _layoutMenu is null) return;
        _modeItem.Text = _host.IsWindowedMode ? "Put back on the desktop" : "Show in a window";
        _layoutMenu.Enabled = !_host.IsWindowedMode;
    }

    // Puts the checkmark next to whichever layout is currently active. Exactly one
    // of the three is true at a time, so this reads as a radio group.
    private void RefreshLayoutLabel()
    {
        if (_singleItem is null || _spanItem is null || _duplicateItem is null) return;
        _singleItem.Checked = _host.Mode == LayoutMode.Single;
        _spanItem.Checked = _host.Mode == LayoutMode.SpanAll;
        _duplicateItem.Checked = _host.Mode == LayoutMode.Duplicate;
    }

    /// <summary>Prefers the shipped app.ico; draws a fallback if it is missing.</summary>
    // The fallback is hand-drawn with GDI+ so the tray icon is never blank even if
    // app.ico didn't get deployed: a dark sky gradient, two curved "aurora" strokes,
    // and a horizon line — a miniature of the scene's mood.
    private Icon BuildIcon()
    {
        string shipped = Path.Combine(AppContext.BaseDirectory, "app.ico");
        if (File.Exists(shipped))
        {
            return new Icon(shipped);
        }

        // 32x32 is the notification-area icon size at 100% DPI. `using` on the bitmap
        // is fine — GetHicon() below copies the pixels into a standalone HICON.
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

        // Stash the raw handle so Dispose() can DestroyIcon() it. Icon.FromHandle
        // wraps it but does NOT take ownership — it won't free the handle for us.
        _iconHandle = bmp.GetHicon();
        return Icon.FromHandle(_iconHandle);
    }

    public void Dispose()
    {
        // Hide before Dispose so the icon disappears from the tray immediately
        // rather than lingering as a ghost until you hover over it.
        if (_icon is not null)
        {
            _icon.Visible = false;
            _icon.Dispose();
            _icon = null;
        }

        // Free the GDI handle from the hand-drawn fallback, if we used one.
        if (_iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
            _iconHandle = IntPtr.Zero;
        }

        Log.Write("Tray removed.");
    }
}
