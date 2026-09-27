// ForegroundWatcher.cs — the backdrop's "is anyone actually looking at me?" sensor.
// A small polling loop that notices when a full-screen app (game, video player,
// slideshow) takes over the screen, and raises an event so SceneHost can tell the
// WebGL scene to pause. The backdrop lives at the very bottom of the z-order, so
// when something covers the whole monitor our animation is 100% wasted GPU/battery.

using System.Windows.Threading;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop.Interop;

/// <summary>
/// Watches for a borderless full-screen app in the foreground (games, video, presentations)
/// and reports it, so the scene can stop burning GPU on pixels nobody can see.
/// </summary>
internal sealed class ForegroundWatcher : IDisposable
{
    // Windows we must NOT treat as "a full-screen app covering the wallpaper":
    //   Progman / WorkerW          — the desktop wallpaper host layers themselves
    //   Shell_TrayWnd              — the taskbar
    //   Windows.UI.Core.CoreWindow — the Start menu / search / action center shell surfaces
    //   #32770                     — the generic dialog class (Alt-Tab switcher, etc.)
    // If any of these is foreground, the desktop is effectively "visible" and we
    // should keep animating.
    private static readonly HashSet<string> ShellClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow", "#32770"
    };

    // We poll on a WPF DispatcherTimer rather than subscribing to a SetWinEventHook
    // (EVENT_SYSTEM_FOREGROUND) callback. Polling every couple of seconds is simpler,
    // has no native callback delegate to keep alive, and runs on the UI thread already —
    // and a 2s reaction delay on "a game just went full-screen" is completely fine.
    private readonly DispatcherTimer _timer;

    // Last reported state. We only fire the event on a transition, so the scene
    // isn't spammed with "still covered" / "still visible" every tick.
    private bool _covered;

    /// <summary>Raised only when the state actually flips.</summary>
    internal event Action<bool>? CoveredChanged;

    internal ForegroundWatcher(TimeSpan interval)
    {
        // DispatcherTimer.Tick is raised on the thread that created it (the UI thread),
        // so the CoveredChanged handler can touch WPF / WebView2 state directly.
        _timer = new DispatcherTimer { Interval = interval };
        _timer.Tick += (_, _) => Poll();
    }

    internal void Start() => _timer.Start();

    // One tick: sample the current state, and only notify listeners if it changed
    // since last time. SceneHost turns a `true` into a "pause the scene" message.
    private void Poll()
    {
        bool covered = IsSomethingFullScreen();
        if (covered == _covered) return;
        _covered = covered;
        CoveredChanged?.Invoke(covered);
    }

    // Heuristic for "the desktop is hidden": whatever owns the foreground right now
    // has a window rectangle that fills (at least) one whole monitor.
    private static bool IsSomethingFullScreen()
    {
        // No foreground window at all (rare, e.g. mid session-switch) — assume visible.
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;

        // The shell surfaces (taskbar, Start, Alt-Tab, the wallpaper host itself)
        // don't count as "an app covering us" even when they're foreground.
        if (ShellClasses.Contains(ClassNameOf(fg))) return false;

        // GetWindowRect gives screen-space pixels. If it fails, don't guess — stay visible.
        if (!GetWindowRect(fg, out RECT r)) return false;

        // Compare against every physical monitor, not the virtual desktop bounds:
        // a game maximised on ONE screen of a multi-monitor setup still fully hides
        // the wallpaper on that screen, which is enough reason to pause.
        foreach (var screen in MonitorLayout.Screens())
        {
            var m = screen.Bounds;
            // A couple of pixels of slack: some apps overshoot the monitor edges
            // (borderless-window games in particular sit at -1,-1 to width+1,height+1).
            if (r.Left <= m.Left + 2 && r.Top <= m.Top + 2 &&
                r.Right >= m.Right - 2 && r.Bottom >= m.Bottom - 2)
            {
                return true;
            }
        }
        return false;
    }

    // Just stop the timer. Nothing native is allocated, so there's nothing else to free.
    public void Dispose() => _timer.Stop();
}
