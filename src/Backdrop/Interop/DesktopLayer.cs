using System.Runtime.InteropServices;
using System.Text;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop.Interop;

internal enum LayerKind
{
    /// <summary>Nothing usable was found; the scene has to stay a normal window.</summary>
    None,

    /// <summary>The real wallpaper layer. Draws above the wallpaper, below the icons.</summary>
    WorkerW,

    /// <summary>No WorkerW appeared, so we live inside Progman at the bottom of its z-order.</summary>
    Progman,
}

internal readonly record struct LayerResult(IntPtr Handle, LayerKind Kind, string Detail);

/// <summary>
/// Finds the shell's wallpaper layer and re-parents our window into it, so the scene
/// draws behind desktop icons instead of on top of the desktop.
///
/// Explorer hands this layer out in two shapes depending on the build:
///   * a top-level WorkerW sitting immediately after the window that owns SHELLDLL_DefView
///   * a WorkerW parented under Progman (common on Windows 11)
/// Both are handled. If neither shows up, Progman itself still works, provided we drop
/// to the bottom of its child z-order so the icons keep painting over us.
/// </summary>
internal static class DesktopLayer
{
    internal static LayerResult Find()
    {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero)
        {
            return new LayerResult(IntPtr.Zero, LayerKind.None, "Progman not found - is Explorer running?");
        }

        // Explorer creates the layer lazily and not always on the first ask, so nudge it
        // a few times before giving up on it.
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            Spawn(progman);

            IntPtr worker = LocateWorkerW(progman);
            if (worker != IntPtr.Zero)
            {
                return new LayerResult(worker, LayerKind.WorkerW, $"WorkerW 0x{worker.ToInt64():X} (attempt {attempt})");
            }

            Thread.Sleep(150);
        }

        return new LayerResult(progman, LayerKind.Progman, $"no WorkerW appeared; using Progman 0x{progman.ToInt64():X}");
    }

    /// <summary>The undocumented poke that makes Explorer materialise the wallpaper layer.</summary>
    private static void Spawn(IntPtr progman)
    {
        SendMessageTimeout(progman, WM_SPAWN_WORKER, new IntPtr(0x0D), new IntPtr(0x01), 0x0000, 1000, out _);
        SendMessageTimeout(progman, WM_SPAWN_WORKER, new IntPtr(0x0D), IntPtr.Zero, 0x0000, 1000, out _);
        SendMessageTimeout(progman, WM_SPAWN_WORKER, IntPtr.Zero, IntPtr.Zero, 0x0000, 1000, out _);
    }

    private static IntPtr LocateWorkerW(IntPtr progman)
    {
        IntPtr found = IntPtr.Zero;

        // Shape one: the sibling directly after whoever owns the icon host.
        EnumWindows((hWnd, _) =>
        {
            if (FindWindowEx(hWnd, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            {
                IntPtr sibling = FindWindowEx(IntPtr.Zero, hWnd, "WorkerW", null);
                if (sibling != IntPtr.Zero) found = sibling;
            }
            return true;
        }, IntPtr.Zero);

        if (found != IntPtr.Zero) return found;

        // Shape two: a child of Progman. Skip whichever one owns the icons.
        IntPtr child = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        while (child != IntPtr.Zero)
        {
            if (FindWindowEx(child, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return child;
            child = FindWindowEx(progman, child, "WorkerW", null);
        }

        return IntPtr.Zero;
    }

    internal static bool Attach(IntPtr window, LayerResult layer, out string failure)
    {
        failure = string.Empty;

        if (layer.Handle == IntPtr.Zero || !IsWindow(layer.Handle))
        {
            failure = "no usable layer handle";
            return false;
        }

        SetParent(window, layer.Handle);
        int error = Marshal.GetLastWin32Error();

        // Two traps here, and the second one is why this used to report failure on a
        // machine where the re-parent had actually worked:
        //
        //   * SetParent returns the *previous* parent, which is null for a top-level
        //     window. Null on its own therefore means nothing.
        //   * GetParent returns the OWNER, not the parent, for any window still carrying
        //     WS_POPUP - which a WPF window does at this exact moment, because the style
        //     fix-up below has not run yet. It answers a different question than the one
        //     being asked.
        //
        // GetAncestor(GA_PARENT) is the one that actually reports the parent.
        IntPtr parent = GetAncestor(window, GA_PARENT);
        if (parent != layer.Handle)
        {
            failure = $"SetParent did not take (parent is 0x{parent.ToInt64():X}, wanted 0x{layer.Handle.ToInt64():X}, win32 error {error})";
            return false;
        }

        long style = GetWindowLong(window, GWL_STYLE);
        style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
        style |= WS_CHILD;
        SetWindowLong(window, GWL_STYLE, style);

        long ex = GetWindowLong(window, GWL_EXSTYLE);
        ex &= ~WS_EX_APPWINDOW;
        ex |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(window, GWL_EXSTYLE, ex);

        // SetParent inserts us at the TOP of the sibling z-order, which would put the
        // scene over the desktop icons. Sink to the bottom so everything else paints
        // above us. This is the difference between a backdrop and an obstruction.
        SetWindowPos(window, HWND_BOTTOM, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        // Show without taking focus. A window that just became WS_CHILD can come back
        // hidden, and a hidden backdrop looks exactly like a failed one.
        ShowWindow(window, SW_SHOWNA);

        return true;
    }

    internal static void Detach(IntPtr window)
    {
        SetParent(window, IntPtr.Zero);

        long style = GetWindowLong(window, GWL_STYLE);
        style &= ~WS_CHILD;
        style |= WS_POPUP;
        SetWindowLong(window, GWL_STYLE, style);

        long ex = GetWindowLong(window, GWL_EXSTYLE);
        ex &= ~(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        SetWindowLong(window, GWL_EXSTYLE, ex);
    }

    /// <summary>
    /// A full picture of the shell's desktop windows. "It doesn't work" is not
    /// actionable; this is.
    /// </summary>
    internal static string Describe()
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Windows      : {Environment.OSVersion.VersionString}");
        sb.AppendLine($"Virtual screen: {MonitorLayout.VirtualBounds.Left},{MonitorLayout.VirtualBounds.Top} " +
                      $"{MonitorLayout.VirtualBounds.Width}x{MonitorLayout.VirtualBounds.Height}");

        var screens = MonitorLayout.Screens();
        for (int i = 0; i < screens.Count; i++)
        {
            var b = screens[i].Bounds;
            sb.AppendLine($"  monitor {i}  : {b.Width}x{b.Height} at {b.Left},{b.Top}" +
                          (screens[i].IsPrimary ? "  (primary)" : string.Empty));
        }

        IntPtr progman = FindWindow("Progman", null);
        sb.AppendLine();
        sb.AppendLine($"Progman      : 0x{progman.ToInt64():X}");

        if (progman == IntPtr.Zero)
        {
            sb.AppendLine("Explorer does not appear to be running.");
            return sb.ToString();
        }

        sb.AppendLine($"  DefView under Progman : 0x{FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null).ToInt64():X}");

        IntPtr child = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        int childCount = 0;
        while (child != IntPtr.Zero)
        {
            bool ownsIcons = FindWindowEx(child, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero;
            sb.AppendLine($"  child WorkerW         : 0x{child.ToInt64():X}{(ownsIcons ? "  (owns icons)" : "  <- candidate")}");
            child = FindWindowEx(progman, child, "WorkerW", null);
            childCount++;
        }
        if (childCount == 0) sb.AppendLine("  child WorkerW         : none");

        int topLevel = 0;
        EnumWindows((hWnd, _) =>
        {
            if (!ClassNameOf(hWnd).Equals("WorkerW", StringComparison.OrdinalIgnoreCase)) return true;
            bool ownsIcons = FindWindowEx(hWnd, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero;
            sb.AppendLine($"  top-level WorkerW     : 0x{hWnd.ToInt64():X}{(ownsIcons ? "  (owns icons)" : string.Empty)}");
            topLevel++;
            return true;
        }, IntPtr.Zero);
        if (topLevel == 0) sb.AppendLine("  top-level WorkerW     : none");

        var result = Find();
        sb.AppendLine();
        sb.AppendLine($"Chosen layer : {result.Kind} - {result.Detail}");

        return sb.ToString();
    }
}
