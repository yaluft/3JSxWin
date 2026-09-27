// DesktopLayer.cs - the "wallpaper window" trick that makes Backdrop a live desktop background.
// Windows has no public API for "draw behind the icons", so we use the same undocumented
// route the classic wallpaper engines (Wallpaper Engine, Lively) use: ask Explorer's Progman
// window to spawn a WorkerW layer that sits between the wallpaper bitmap and the icon layer,
// then SetParent our WPF window into it. Find() locates the layer, Attach() re-parents into
// it, Detach() undoes that, and Describe() dumps the whole shell window tree for --diagnose.

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

// The outcome of a Find(): which handle to parent into, what kind it is, and a
// human-readable Detail string that ends up in the log and in --diagnose output.
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
        // Progman is the desktop window Explorer owns. It is our entry point: it hosts the
        // wallpaper, and it is the window we send the spawn message to. No Progman means
        // Explorer is not running (or crashed), and there is nothing to attach to at all.
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero)
        {
            return new LayerResult(IntPtr.Zero, LayerKind.None, "Progman not found - is Explorer running?");
        }

        // Explorer creates the WorkerW layer lazily, and the spawn message does not always
        // take on the first ask (timing against Explorer's own message pump). So we poke it,
        // look, sleep briefly, and repeat up to three times before falling back to Progman.
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

        // No WorkerW ever showed up. We can still parent straight into Progman - the scene
        // just has to sink to the bottom of Progman's child z-order so the icons paint over
        // it. Slightly worse (some shell overlays can end up above us) but it works.
        return new LayerResult(progman, LayerKind.Progman, $"no WorkerW appeared; using Progman 0x{progman.ToInt64():X}");
    }

    /// <summary>The undocumented poke that makes Explorer materialise the wallpaper layer.</summary>
    // 0x052C is an internal Progman message (we call it WM_SPAWN_WORKER). It has no name in
    // any SDK header - it was reverse-engineered from Explorer. Sending it tells Progman to
    // split its single wallpaper-painting window into two WorkerW windows with a
    // SHELLDLL_DefView (the icon host) sandwiched between them. That gap is exactly where a
    // live wallpaper wants to live: above the static bitmap, below the icons.
    //
    // We use SendMessageTimeout, not SendMessage, so a hung Explorer can't freeze our
    // startup - each call bails after 1000 ms. The three variants pass different
    // wParam/lParam because the exact values Explorer expects have drifted across Windows
    // builds; sending all three covers Win10 and Win11 without version-sniffing.
    private static void Spawn(IntPtr progman)
    {
        SendMessageTimeout(progman, WM_SPAWN_WORKER, new IntPtr(0x0D), new IntPtr(0x01), 0x0000, 1000, out _);
        SendMessageTimeout(progman, WM_SPAWN_WORKER, new IntPtr(0x0D), IntPtr.Zero, 0x0000, 1000, out _);
        SendMessageTimeout(progman, WM_SPAWN_WORKER, IntPtr.Zero, IntPtr.Zero, 0x0000, 1000, out _);
    }

    // After Spawn(), the wallpaper WorkerW can be arranged in one of two ways depending on
    // the Windows build. We probe for both. The tell in each case is SHELLDLL_DefView: the
    // window that owns *that* child is the icon layer, and the WorkerW we want is the one
    // that does NOT own it (it's the blank layer sitting behind the icons).
    private static IntPtr LocateWorkerW(IntPtr progman)
    {
        IntPtr found = IntPtr.Zero;

        // Shape one (Windows 10): DefView lives under a top-level window, and the wallpaper
        // WorkerW is that window's very next sibling in the z-order. Walk every top-level
        // window; when we hit the one hosting DefView, grab the WorkerW right after it.
        // (FindWindowEx with a null parent + hWndChildAfter enumerates top-level siblings.)
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

        // Shape two (common on Windows 11): both WorkerWs are direct children of Progman.
        // Enumerate them and return the first one that does NOT contain DefView - that's
        // the wallpaper layer; the other one is holding the icons.
        IntPtr child = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        while (child != IntPtr.Zero)
        {
            if (FindWindowEx(child, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return child;
            child = FindWindowEx(progman, child, "WorkerW", null);
        }

        return IntPtr.Zero;
    }

    /// <summary>
    /// Error 1400 (ERROR_INVALID_WINDOW_HANDLE) means Explorer destroyed the WorkerW in
    /// the gap between Find() and SetParent(). Callers should treat this as a transient
    /// and call Find() + Attach() again immediately.
    /// </summary>
    internal const int ERROR_INVALID_WINDOW_HANDLE = 1400;

    // Re-parents our WPF window (its HWND) into the wallpaper layer and rewrites its window
    // styles so Windows treats it as a well-behaved child of the desktop rather than a
    // floating app window. Returns false with a reason in `failure` if anything didn't take.
    internal static bool Attach(IntPtr window, LayerResult layer, out string failure)
    {
        failure = string.Empty;

        // The handle came from a Find() that may have run seconds ago; make sure Explorer
        // hasn't torn it down since.
        if (layer.Handle == IntPtr.Zero || !IsWindow(layer.Handle))
        {
            failure = "no usable layer handle";
            return false;
        }

        // The actual re-parent. Grab the Win32 error immediately - any later call would
        // overwrite it before we get to inspect it below.
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
            // If Explorer destroyed the WorkerW between Find() and SetParent() the OS
            // returns ERROR_INVALID_WINDOW_HANDLE. Signal this distinctly so the caller
            // can re-find immediately rather than waiting for the retry timer.
            if (error == ERROR_INVALID_WINDOW_HANDLE)
                failure = $"layer handle stale (win32 error {error}) — will re-find";
            else
                failure = $"SetParent did not take (parent is 0x{parent.ToInt64():X}, wanted 0x{layer.Handle.ToInt64():X}, win32 error {error})";
            return false;
        }

        // Now make the window actually behave like a child. WPF created it as a top-level
        // popup with a caption and a resize frame; strip those and set WS_CHILD so it clips
        // to the WorkerW and moves with it instead of being an independent window.
        long style = GetWindowLong(window, GWL_STYLE);
        style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
        style |= WS_CHILD;
        SetWindowLong(window, GWL_STYLE, style);

        // Extended styles: drop APPWINDOW so it never shows in the taskbar or Alt-Tab, add
        // TOOLWINDOW (same effect, belt and braces) and NOACTIVATE so clicking the desktop
        // never brings the scene forward or steals focus from a real app.
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

    // The inverse of Attach(): lift the window back out of the WorkerW and restore the
    // top-level popup styles. Called on shutdown, and before a re-find when Explorer
    // restarts (a new WorkerW means the old parent is gone and we have to re-attach clean).
    internal static void Detach(IntPtr window)
    {
        // Parent back to the desktop (null == top-level).
        SetParent(window, IntPtr.Zero);

        // Undo the style swap: WS_CHILD out, WS_POPUP back in, so WPF can manage it as a
        // normal window again.
        long style = GetWindowLong(window, GWL_STYLE);
        style &= ~WS_CHILD;
        style |= WS_POPUP;
        SetWindowLong(window, GWL_STYLE, style);

        // Drop the tool-window / no-activate bits we added.
        long ex = GetWindowLong(window, GWL_EXSTYLE);
        ex &= ~(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        SetWindowLong(window, GWL_EXSTYLE, ex);
    }

    /// <summary>
    /// A full picture of the shell's desktop windows. "It doesn't work" is not
    /// actionable; this is.
    /// </summary>
    // Backing for `Backdrop --diagnose`. It walks the same shell windows Find() does, but
    // prints everything it sees instead of stopping at the first match - so when attach
    // fails on someone's machine they can paste this and we can see which shape their
    // Explorer is in (or that DefView / WorkerW is missing entirely).
    internal static string Describe()
    {
        var sb = new StringBuilder();

        // Environment first: OS build and the virtual-screen rectangle (the bounding box of
        // all monitors). A wrong-looking virtual screen explains a mis-sized backdrop.
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

        // Note we do NOT call Spawn() here - Describe() reports the shell as it is right now.
        // (Find() at the end does spawn, so the "Chosen layer" line reflects post-poke state.)
        IntPtr progman = FindWindow("Progman", null);
        sb.AppendLine();
        sb.AppendLine($"Progman      : 0x{progman.ToInt64():X}");

        if (progman == IntPtr.Zero)
        {
            sb.AppendLine("Explorer does not appear to be running.");
            return sb.ToString();
        }

        // If DefView is a direct child of Progman, the shell hasn't split yet (or this build
        // keeps the icons on Progman itself) - shape two territory.
        sb.AppendLine($"  DefView under Progman : 0x{FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null).ToInt64():X}");

        // Every WorkerW that is a child of Progman. The one WITHOUT DefView is our candidate
        // (shape two); the one WITH it is holding the icons.
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

        // Every top-level WorkerW (shape one). ClassNameOf filters the EnumWindows callback
        // since there is no class filter on EnumWindows itself.
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

        // Finally run the real Find() (this one does poke Progman) and report what it picked,
        // so the diagnosis ends with the exact decision the app would make.
        var result = Find();
        sb.AppendLine();
        sb.AppendLine($"Chosen layer : {result.Kind} - {result.Detail}");

        return sb.ToString();
    }
}
