// MonitorLayout.cs
// Answers "where are the monitors and how big is the desktop?" for the positioning code.
// Wraps the classic Win32 monitor-enumeration APIs and the virtual-screen system metrics,
// plus the per-monitor DPI lookup WPF needs. Pure geometry — it moves nothing itself.

using System.Runtime.InteropServices;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop.Interop;

/// <summary>
/// Physical-pixel monitor geometry. Everything the backdrop positions is in physical
/// pixels, because the WorkerW layer it lives on is addressed that way.
/// </summary>
// Why physical pixels: the wallpaper/WorkerW layer is a plain unscaled Win32 surface.
// The shell never applies DPI scaling to it, so SetWindowPos on our host window expects
// raw device pixels. We keep every rectangle in this file in that same coordinate space
// and only convert to WPF's device-independent pixels (DIPs) at the very last step.
internal static class MonitorLayout
{
    // MONITORINFOEX is what GetMonitorInfo fills in for one display. The layout must match
    // the C struct byte-for-byte or the marshaller reads garbage:
    //  - cbSize        we set this before the call; it's how the API tells MONITORINFO from
    //                  MONITORINFOEX (the "EX" adds szDevice).
    //  - rcMonitor     the full monitor rectangle in virtual-screen coordinates.
    //  - rcWork        rcMonitor minus the taskbar / appbars. We don't use it — the backdrop
    //                  covers the whole monitor, taskbar included.
    //  - dwFlags       bit 0 (MONITORINFOF_PRIMARY) marks the primary display.
    //  - szDevice      the \\.\DISPLAYn device name; a fixed 32-char inline buffer, hence
    //                  ByValTStr + SizeConst = 32.
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

    // EnumDisplayMonitors calls this once per monitor. Returning true keeps the enumeration
    // going; false stops it early. We always return true so we see every display.
    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);

    // EnumDisplayMonitors: the canonical "walk every monitor" API. Pass null hdc/clip to get
    // all of them; the callback fires synchronously before this returns.
    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    // GetMonitorInfo: given a monitor handle from the enum callback, fill in a MONITORINFOEX
    // (rectangle, primary flag, device name). CharSet.Unicode selects the ...W entry point.
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);

    // dwFlags bit that means "this is the primary monitor" (the one with the Start button,
    // and the origin (0,0) of virtual-screen space).
    private const uint MONITORINFOF_PRIMARY = 0x1;

    // A flattened snapshot of one monitor: just the bits the positioning code needs.
    // record struct gives us value equality for free, handy when detecting layout changes.
    internal readonly record struct Screen(RECT Bounds, bool IsPrimary, string Device);

    // Top-left corner of the virtual screen (the bounding box of ALL monitors together).
    // It is NOT always (0,0): put a second monitor to the left of the primary and this goes
    // negative. The positioning code needs this offset to translate monitor rectangles into
    // coordinates relative to the WorkerW layer.
    internal static (int X, int Y) VirtualOrigin =>
        (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));

    // The whole virtual screen as one RECT. Windows only hands us origin + size via four
    // separate system metrics, so we add them up here. Used for "span every monitor" mode.
    internal static RECT VirtualBounds
    {
        get
        {
            // SM_X/YVIRTUALSCREEN is the origin; SM_CX/CYVIRTUALSCREEN is width/height.
            // Right/Bottom are exclusive, so origin + extent gives the far edge.
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

    // Enumerate every connected monitor into a stable, ordered list.
    internal static List<Screen> Screens()
    {
        var found = new List<Screen>();

        // The callback runs synchronously, once per monitor, before EnumDisplayMonitors
        // returns — so by the time we sort below, `found` is fully populated.
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) =>
        {
            // cbSize MUST be set first — that's how GetMonitorInfo knows we want the "EX"
            // struct (with szDevice) and not the shorter MONITORINFO.
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(h, ref info))
            {
                // We take rcMonitor (full bounds), not rcMonitor from the `ref RECT r` arg,
                // because r isn't DPI-consistent across mixed-DPI setups; MONITORINFOEX is.
                found.Add(new Screen(info.rcMonitor, (info.dwFlags & MONITORINFOF_PRIMARY) != 0, info.szDevice));
            }
            return true;
        }, IntPtr.Zero);

        // Windows enumerates monitors in an unspecified order (roughly install order), which
        // shifts when you unplug/replug a display. Sort left-to-right then top-to-bottom so
        // "--monitor 1" always means the same physical screen across reboots.
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
    // Concrete example: a 3840px-wide 4K monitor at 150% scaling reports dpiX = 144, so this
    // returns 1.5. We then tell WPF the window is 3840 / 1.5 = 2560 DIPs wide; WPF scales
    // that back up to 3840 real pixels and the backdrop lands edge-to-edge.
    internal static double ScaleFactorFor(IntPtr hwnd)
    {
        // MONITOR_DEFAULTTONEAREST: for an on-screen window this never returns null, so we
        // always get a usable handle even if the window straddles two monitors.
        IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);

        // GetDpiForMonitor lives in shcore.dll and returns 0 (S_OK) on success. MDT_EFFECTIVE_DPI
        // asks for the DPI the shell actually renders at (respecting the user's scaling slider),
        // not the panel's raw hardware DPI. dpiX and dpiY are always equal on Windows.
        if (monitor != IntPtr.Zero &&
            GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out uint dpiX, out _) == 0 && dpiX != 0)
        {
            return dpiX / 96.0; // 96 DPI is the "100% scaling" baseline.
        }

        // Anything unexpected: assume no scaling rather than throw. A wrong-by-scale backdrop
        // is better than a crash on startup.
        return 1.0;
    }

    /// <summary>The rectangle the backdrop should cover, in physical pixels.</summary>
    // This is the one function the rest of the app calls. It folds the CLI/tray choice
    // (span everything, or a specific monitor) down to a single rectangle, with fallbacks
    // at every step so we always return *something* sane.
    internal static RECT TargetBounds(bool spanAll, int monitorIndex)
    {
        // "Span all monitors" — just hand back the whole virtual screen.
        if (spanAll) return VirtualBounds;

        var screens = Screens();

        // No monitors enumerated (RDP session, driver hiccup): fall back to virtual bounds
        // so the backdrop still shows up somewhere instead of at a zero-size rect.
        if (screens.Count == 0) return VirtualBounds;

        // An explicit, in-range --monitor N wins.
        if (monitorIndex >= 0 && monitorIndex < screens.Count) return screens[monitorIndex].Bounds;

        // Otherwise default to the primary monitor...
        foreach (var s in screens)
        {
            if (s.IsPrimary) return s.Bounds;
        }

        // ...and if somehow nothing is flagged primary, the leftmost screen (index 0 after
        // the sort in Screens()).
        return screens[0].Bounds;
    }
}
