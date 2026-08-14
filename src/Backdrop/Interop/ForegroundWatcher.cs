using System.Windows.Threading;
using static Backdrop.Interop.NativeMethods;

namespace Backdrop.Interop;

/// <summary>
/// Watches for a borderless full-screen app in the foreground (games, video, presentations)
/// and reports it, so the scene can stop burning GPU on pixels nobody can see.
/// </summary>
internal sealed class ForegroundWatcher : IDisposable
{
    private static readonly HashSet<string> ShellClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow", "#32770"
    };

    private readonly DispatcherTimer _timer;
    private bool _covered;

    /// <summary>Raised only when the state actually flips.</summary>
    internal event Action<bool>? CoveredChanged;

    internal ForegroundWatcher(TimeSpan interval)
    {
        _timer = new DispatcherTimer { Interval = interval };
        _timer.Tick += (_, _) => Poll();
    }

    internal void Start() => _timer.Start();

    private void Poll()
    {
        bool covered = IsSomethingFullScreen();
        if (covered == _covered) return;
        _covered = covered;
        CoveredChanged?.Invoke(covered);
    }

    private static bool IsSomethingFullScreen()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        if (ShellClasses.Contains(ClassNameOf(fg))) return false;
        if (!GetWindowRect(fg, out RECT r)) return false;

        foreach (var screen in MonitorLayout.Screens())
        {
            var m = screen.Bounds;
            // A couple of pixels of slack: some apps overshoot the monitor edges.
            if (r.Left <= m.Left + 2 && r.Top <= m.Top + 2 &&
                r.Right >= m.Right - 2 && r.Bottom >= m.Bottom - 2)
            {
                return true;
            }
        }
        return false;
    }

    public void Dispose() => _timer.Stop();
}
