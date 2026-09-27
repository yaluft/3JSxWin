using System.Diagnostics;
using System.IO;

namespace Backdrop.Startup;

/// <summary>
/// Dual-monitor mode starts two WebView2 controllers on one Chromium browser process.
/// If Backdrop is killed or relaunched before that process exits, the next instance
/// inherits a live Chrome_WidgetWin_0 class (Win32 1412) and leftover msedgewebview2
/// children. Remember the browser pid and reap it when we are sure we own the mutex.
/// </summary>
internal static class WebViewLifetime
{
    // We stash the browser pid in a tiny text file next to the log so the NEXT
    // process (a different run) can find and kill it.
    private static string PidPath => Path.Combine(Log.Folder, "webview.pid");

    // Called once after the WebView2 environment comes up, with its browser pid.
    internal static void Remember(uint pid)
    {
        if (pid == 0) return;
        try
        {
            Directory.CreateDirectory(Log.Folder);
            File.WriteAllText(PidPath, pid.ToString());
        }
        catch (Exception ex)
        {
            Log.Write("Could not record WebView2 pid", ex);
        }
    }

    // Called during startup (App.OnStartup) once we know we're the only instance.
    // Reads the stashed pid and kills that browser if it's still alive.
    internal static void ReapPrevious()
    {
        try
        {
            if (!File.Exists(PidPath)) return;
            if (!int.TryParse(File.ReadAllText(PidPath).Trim(), out int pid) || pid <= 0) return;
            KillBrowser(pid);
        }
        catch (Exception ex)
        {
            Log.Write("Could not reap previous WebView2", ex);
        }
    }

    internal static void KillBrowser(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);

            // Safety check: the pid may have been recycled by the OS onto some
            // unrelated process. Only kill it if it's actually a WebView2 browser.
            if (!process.ProcessName.Contains("msedgewebview2", StringComparison.OrdinalIgnoreCase))
                return;

            // entireProcessTree: the browser spawns renderer/GPU child processes;
            // kill the whole family or the children keep the window class alive.
            process.Kill(entireProcessTree: true);
            if (!process.WaitForExit(1500))
                Log.Write($"WebView2 pid {pid} did not exit in time.");
            else
                Log.Write($"Reaped leftover WebView2 pid {pid}.");
        }
        catch (ArgumentException)
        {
            // GetProcessById throws this when the pid is already gone — which is
            // the happy path here, so just ignore it.
        }
        catch (Exception ex)
        {
            Log.Write("WebView2 kill", ex);
        }
    }
}
