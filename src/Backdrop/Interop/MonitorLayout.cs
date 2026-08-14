using System.Runtime.InteropServices;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop.Interop;

/// <summary>
/// Physical-pixel monitor geometry. Everything the backdrop positions is in physical
/// pixels, because the WorkerW layer it lives on is addressed that way.
/// </summary>
internal static class MonitorLayout
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);

    private const uint MONITORINFOF_PRIMARY = 0x1;

    internal readonly record struct Screen(RECT Bounds, bool IsPrimary, string Device);

    internal static (int X, int Y) VirtualOrigin =>
        (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));

    internal static RECT VirtualBounds
    {
        get
        {
            int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            return new RECT
            {
                Left = x,
                Top = y,
                Right = x + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                Bottom = y + GetSystemMetrics(SM_CYVIRTUALSCREEN)
            };
        }
    }

    internal static List<Screen> Screens()
    {
        var found = new List<Screen>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) =>
        {
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(h, ref info))
            {
                found.Add(new Screen(info.rcMonitor, (info.dwFlags & MONITORINFOF_PRIMARY) != 0, info.szDevice));
            }
            return true;
        }, IntPtr.Zero);

        // Left-to-right, then top-to-bottom, so --monitor N is stable across reboots.
        found.Sort((a, b) => a.Bounds.Left != b.Bounds.Left
            ? a.Bounds.Left.CompareTo(b.Bounds.Left)
            : a.Bounds.Top.CompareTo(b.Bounds.Top));
        return found;
    }

    /// <summary>
    /// The DPI scale factor (1.0 = 96 DPI, 1.5 = 150%) of the monitor the given window sits
    /// on. WPF applies exactly this factor to the whole window, so dividing a physical size
    /// by it yields the DIP size WPF needs to fill that physical region.
    /// </summary>
    internal static double ScaleFactorFor(IntPtr hwnd)
    {
        IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor != IntPtr.Zero &&
            GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out uint dpiX, out _) == 0 && dpiX != 0)
        {
            return dpiX / 96.0;
        }
        return 1.0;
    }

    /// <summary>The rectangle the backdrop should cover, in physical pixels.</summary>
    internal static RECT TargetBounds(bool spanAll, int monitorIndex)
    {
        if (spanAll) return VirtualBounds;

        var screens = Screens();
        if (screens.Count == 0) return VirtualBounds;

        if (monitorIndex >= 0 && monitorIndex < screens.Count) return screens[monitorIndex].Bounds;

        foreach (var s in screens)
        {
            if (s.IsPrimary) return s.Bounds;
        }
        return screens[0].Bounds;
    }
}
