// NativeMethods.cs — the P/Invoke wall. Every Win32 function and magic constant the
// interop layer needs lives here and ONLY here, so the rest of the code reads like C#.
// Think of this as the Rosetta stone: DesktopLayer, MonitorLayout, ForegroundWatcher
// and Hotkey all speak through these signatures. Nothing here makes a decision — it
// just exposes user32/shcore to managed callers.

using System.Runtime.InteropServices;
using System.Text;

namespace Backdrop.Interop;

/// <summary>Raw Win32 entry points. Nothing in here makes decisions.</summary>
internal static class NativeMethods
{
    // GetWindowLong / SetWindowLong index constants. Every window carries two 32/64-bit
    // bitfields of flags; you read or write one by passing its negative index.
    //   GWL_STYLE   (-16) = the WS_* style bits   (WS_POPUP, WS_CHILD, WS_CAPTION...)
    //   GWL_EXSTYLE (-20) = the WS_EX_* extended style bits (tool window, transparent...)
    // We flip bits in both when parking a window on the wallpaper layer.
    internal const int GWL_STYLE = -16;
    internal const int GWL_EXSTYLE = -20;

    // WS_* base window styles (GWL_STYLE). The desktop-attach dance rewrites these:
    //   WS_CHILD      — window is a child of another HWND; clipped to and moves with parent.
    //   WS_POPUP      — top-level popup. A WPF window is born WS_POPUP; mutually exclusive
    //                   with WS_CHILD, so we must clear one before setting the other.
    //   WS_CAPTION    — has a title bar. Cleared so the wallpaper has no chrome.
    //   WS_THICKFRAME — has a resizable border. Cleared for the same reason.
    internal const long WS_CHILD = 0x40000000L;
    internal const long WS_POPUP = 0x80000000L;
    internal const long WS_CAPTION = 0x00C00000L;
    internal const long WS_THICKFRAME = 0x00040000L;

    // WS_EX_* extended window styles (GWL_EXSTYLE).
    //   WS_EX_TOOLWINDOW — keeps the window out of the taskbar and the Alt+Tab list.
    //   WS_EX_NOACTIVATE — the window never becomes the active/foreground window on click.
    //   WS_EX_APPWINDOW  — the opposite: forces a taskbar button. We CLEAR this one for
    //                      the wallpaper and SET it for the comms window (see below).
    internal const long WS_EX_TOOLWINDOW = 0x00000080L;
    internal const long WS_EX_NOACTIVATE = 0x08000000L;
    internal const long WS_EX_APPWINDOW = 0x00040000L;

    // SWP_* flags for SetWindowPos. Each one says "ignore this argument / skip this step",
    // so you OR together the parts of the call you DON'T want to happen.
    //   SWP_NOSIZE      — ignore the cx/cy arguments (don't resize).
    //   SWP_NOMOVE      — ignore the X/Y arguments (don't move).
    //   SWP_NOZORDER    — ignore hWndInsertAfter (don't restack).
    //   SWP_NOACTIVATE  — don't activate the window as a side effect.
    //   SWP_FRAMECHANGED— recalc the non-client frame; needed after a GWL style change
    //                     or the old frame is cached until the next resize.
    //   SWP_SHOWWINDOW  — show the window as part of this call.
    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_NOZORDER = 0x0004;
    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_FRAMECHANGED = 0x0020;
    internal const uint SWP_SHOWWINDOW = 0x0040;

    // The four "special HWNDs" you pass to SetWindowPos as hWndInsertAfter. They're not
    // real windows — they're sentinel pointer values (1, 0, -1, -2) the OS recognises.
    // Backdrop only uses the first three.

    /// <summary>Bottom of the sibling z-order: everything else paints over us.</summary>
    // This is where the wallpaper wants to live — under the icons, under every app window.
    internal static readonly IntPtr HWND_BOTTOM = new(1);

    /// <summary>Top of the sibling z-order: used briefly so the panel sits over the icons.</summary>
    // Regular "top", NOT always-on-top. Loses its spot the moment another window activates.
    internal static readonly IntPtr HWND_TOP = new(0);

    /// <summary>Always-on-top of every non-topmost window. Comms / console sit here.</summary>
    // The overlay HUD windows stay pinned above normal apps so the user can always see them.
    internal static readonly IntPtr HWND_TOPMOST = new(-1);

    // WS_EX_TRANSPARENT — the window is "click-through": mouse messages fall past it to
    // whatever is underneath. Combined with a layered window this makes an overlay that
    // paints but never intercepts input.
    internal const long WS_EX_TRANSPARENT = 0x00000020L;

    // WM_NCLBUTTONDOWN with HTCAPTION as wParam = "the user pressed the left button on the
    // title bar". Posting this by hand after ReleaseCapture() lets a borderless window be
    // dragged by its client area — the OS runs its normal move loop. See CommsWindow.
    internal const uint WM_NCLBUTTONDOWN = 0x00A1;
    internal const int HTCAPTION = 2;

    [DllImport("user32.dll")]
    internal static extern bool ReleaseCapture();

    // Synchronous SendMessage: blocks until the target window's WndProc returns. Fine for
    // the drag trick above where we're talking to our own window.
    [DllImport("user32.dll")]
    internal static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    /// <summary>Undocumented Progman message that forces the WorkerW wallpaper layer to exist.</summary>
    // 0x052C has no name in the SDK. Sending it to Progman makes Explorer spawn the WorkerW
    // window that the live-wallpaper trick parents into. See DesktopLayer.SpawnWorker.
    internal const uint WM_SPAWN_WORKER = 0x052C;

    // GetSystemMetrics indices for the "virtual screen" — the bounding box of ALL monitors
    // combined, in desktop pixels. Origin can be negative if a monitor sits left of / above
    // the primary. MonitorLayout uses these to size a window that spans every display.
    internal const int SM_XVIRTUALSCREEN = 76;
    internal const int SM_YVIRTUALSCREEN = 77;
    internal const int SM_CXVIRTUALSCREEN = 78;
    internal const int SM_CYVIRTUALSCREEN = 79;

    // Callback signature for EnumWindows: return true to keep enumerating, false to stop.
    internal delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    // Win32 RECT is right/bottom-EXCLUSIVE (Right - Left == width). The struct layout must
    // match the C header field-for-field, hence [StructLayout(Sequential)]; the Width/Height
    // helpers are ours, not part of the marshalled data.
    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }

    // FindWindow: top-level window by class name and/or title. Pass null to wildcard a field.
    // This is how we grab "Progman" (the desktop) by its well-known class.
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    // FindWindowEx: like FindWindow but scoped to children of hWndParent, and resumable —
    // pass the previously returned handle as hWndChildAfter to get the NEXT match. Used to
    // walk the several "WorkerW" siblings and pick the one that isn't holding the icons.
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string? lpszClass, string? lpszWindow);

    // EnumWindows: calls back once per top-level window. We use it when the WorkerW we want
    // is a top-level sibling of Progman rather than a child (the layout varies by Win build).
    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    // SetParent: re-parents hWndChild under hWndNewParent (pass IntPtr.Zero to detach back
    // to the desktop). This is the core of the live-wallpaper trick — we make the WPF window
    // a child of WorkerW so it renders behind the icons. Returns the PREVIOUS parent, which
    // is misleading here (see GetAncestor note), so callers verify with GetAncestor instead.
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    // GetParent: DON'T trust this one during the attach dance. For a window that still has
    // WS_POPUP it returns the OWNER, not the parent. Kept for completeness / debug dumps.
    [DllImport("user32.dll")]
    internal static extern IntPtr GetParent(IntPtr hWnd);

    /// <summary>GA_PARENT. The only reliable way to ask who a window's parent is.</summary>
    // GetAncestor(hWnd, GA_PARENT) walks the real parent chain and ignores owner links, so
    // it gives a straight answer even mid-restyle. This is how we confirm SetParent stuck.
    internal const uint GA_PARENT = 1;

    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    /// <summary>SW_SHOWNA: show without stealing activation.</summary>
    // "Show, No Activate" — the wallpaper appears but the current foreground app keeps focus.
    // A freshly-childed window otherwise tends to yank activation on first show.
    internal const int SW_SHOWNA = 8;

    // SetWindowPos: the swiss-army knife for move / resize / restack / show, all in one call.
    // hWndInsertAfter takes a real HWND or one of the HWND_* sentinels; the SWP_* flags say
    // which arguments to honour. We mostly use it just to drop the window to HWND_BOTTOM.
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    // SendMessageTimeout: like SendMessage but gives up after uTimeout ms instead of hanging
    // if the target window is wedged. Essential when poking Progman — Explorer might be busy
    // and we don't want to freeze startup. fuFlags below (SMTO_*) tune that behaviour.
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

    // GetWindowLongPtr / SetWindowLongPtr — read / write one of a window's flag bitfields
    // (indexed by GWL_STYLE / GWL_EXSTYLE above). We import the "Ptr" + "W" (Unicode) form
    // explicitly so this is correct on 64-bit, where the classic GetWindowLong is only 32
    // bits wide and would truncate WS_POPUP (0x80000000) and friends. The public wrappers
    // below hand callers a plain `long` so the bit-twiddling in DesktopLayer stays readable.
    [DllImport("user32.dll", SetLastError = true, EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true, EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    internal static long GetWindowLong(IntPtr hWnd, int nIndex) => GetWindowLongPtr64(hWnd, nIndex).ToInt64();

    internal static void SetWindowLong(IntPtr hWnd, int nIndex, long value) => SetWindowLongPtr64(hWnd, nIndex, new IntPtr(value));

    // IsWindow: is this handle still a live window? Handles get recycled, so we re-check the
    // cached WorkerW handle on every reattach before trusting it.
    [DllImport("user32.dll")]
    internal static extern bool IsWindow(IntPtr hWnd);

    // The focus / activation group. Backdrop mostly wants to AVOID stealing focus (it's
    // wallpaper), so GetForegroundWindow is used to observe who's in front; the setters are
    // here for the windowed/HUD paths that legitimately need to come forward.
    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetActiveWindow(IntPtr hWnd);

    // GetWindowRect: the window's outer bounds in screen pixels. ForegroundWatcher uses it
    // to tell whether the current foreground window is actually covering the desktop.
    [DllImport("user32.dll")]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    // GetClassName: the window-class string (e.g. "WorkerW", "Progman", "Shell_TrayWnd").
    // CharSet.Unicode so we get the wide version and no character loss. Wrapped by
    // ClassNameOf() below so callers never touch the StringBuilder buffer dance.
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    // GetSystemMetrics: integer system measurements by index — here only the SM_*VIRTUALSCREEN
    // four, for the all-monitors bounding box.
    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int nIndex);

    // SystemParametersInfo: read/write a shell setting. With a RECT out-param it's typically
    // SPI_GETWORKAREA — the monitor area minus the taskbar — which HUD windows use to avoid
    // being placed under the taskbar.
    [DllImport("user32.dll")]
    internal static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref RECT pvParam, uint fWinIni);

    // MonitorFromWindow: which monitor a window is (mostly) on. Feeds GetDpiForMonitor so we
    // scale each window by the DPI of the display it's actually sitting on, not the primary.
    [DllImport("user32.dll")]
    internal static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    /// <summary>MONITOR_DEFAULTTONEAREST: never returns null for an on-screen window.</summary>
    // The other flags can return NULL when a window is off every monitor; "nearest" always
    // hands back a real HMONITOR so the DPI lookup can't fail on us.
    internal const uint MONITOR_DEFAULTTONEAREST = 2;

    /// <summary>MDT_EFFECTIVE_DPI: the DPI the shell actually scales this monitor at.</summary>
    // As opposed to raw or angular DPI — "effective" is the number that matches what the
    // user picked in Display Settings (100% = 96, 150% = 144...).
    internal const int MDT_EFFECTIVE_DPI = 0;

    // GetDpiForMonitor lives in shcore.dll, not user32. Per-monitor DPI (Win 8.1+) is why
    // this is a separate call instead of one global value.
    [DllImport("shcore.dll")]
    internal static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

    // Convenience wrapper: allocate the buffer, call GetClassName, hand back a string.
    // 256 chars is comfortably above any real Win32 class name.
    internal static string ClassNameOf(IntPtr hWnd)
    {
        var sb = new StringBuilder(256);
        GetClassName(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
