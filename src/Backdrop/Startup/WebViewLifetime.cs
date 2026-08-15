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
    private static string PidPath => Path.Combine(Log.Folder, "webview.pid");

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
            if (!process.ProcessName.Contains("msedgewebview2", StringComparison.OrdinalIgnoreCase))
                return;
            process.Kill(entireProcessTree: true);
            if (!process.WaitForExit(1500))
                Log.Write($"WebView2 pid {pid} did not exit in time.");
            else
                Log.Write($"Reaped leftover WebView2 pid {pid}.");
        }
        catch (ArgumentException)
        {
            // already gone
        }
        catch (Exception ex)
        {
            Log.Write("WebView2 kill", ex);
        }
    }
}
