using System.Diagnostics;
using System.IO;
using System.Text;
using Backdrop.Startup;

using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace Backdrop.DevLoop;

/// <summary>
/// A solo-developer convenience triggered by Win+Shift+-: rebuild the project and swap the
/// running instance for the freshly built one. Never touches dist\ directly while this
/// process might be running from it — the build always lands in a staging folder first, and
/// only a successful build leads to killing this process, so a broken build never takes down
/// a working wallpaper.
/// </summary>
internal sealed class RebuildAndRelaunch
{
    private const string StagingFolderName = "dist.new";
    private const string DistFolderName = "dist";
    private const string ExeName = "Backdrop.exe";

    private bool _inFlight;

    internal void Trigger()
    {
        if (_inFlight)
        {
            Log.Write("Rebuild hotkey pressed while a build is already in flight; ignored.");
            return;
        }
        _inFlight = true;

        Task.Run(RunAsync).ContinueWith(_ => _inFlight = false);
    }

    private static void RunAsync()
    {
        Log.Write("Rebuild hotkey pressed.");

        string? repoRoot = FindRepoRoot();
        if (repoRoot is null)
        {
            Log.Write("Rebuild hotkey: could not locate build.ps1 (walked up from " +
                      $"{AppContext.BaseDirectory} and checked BACKDROP_REPO_ROOT). Nothing to do.");
            return;
        }

        string stagingPath = Path.Combine(repoRoot, StagingFolderName);
        string distPath = Path.Combine(repoRoot, DistFolderName);

        var (exitCode, output) = RunBuildScript(repoRoot, stagingPath);
        if (exitCode != 0)
        {
            Log.Write($"Rebuild failed (exit {exitCode}). Output tail:{Environment.NewLine}{Tail(output)}");
            MessageBox.Show(
                $"Backdrop rebuild failed (exit {exitCode}).\n\nSee {Log.File} for the full build output.\n\n{stagingPath} left in place for inspection.",
                "Backdrop rebuild failed", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        string stagedExe = Path.Combine(stagingPath, ExeName);
        if (!File.Exists(stagedExe))
        {
            Log.Write($"Rebuild reported success but {stagedExe} is missing. Aborting relaunch.");
            MessageBox.Show(
                $"Backdrop rebuild reported success, but {stagedExe} was not found.\n\nSee {Log.File}.",
                "Backdrop rebuild failed", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        Log.Write($"Rebuild succeeded. Spawning relauncher for PID {Environment.ProcessId}.");

        try
        {
            SpawnRelauncher(Environment.ProcessId, stagingPath, distPath);
        }
        catch (Exception ex)
        {
            Log.Write("Failed to spawn relauncher; not shutting down", ex);
            MessageBox.Show(
                $"Backdrop rebuilt successfully, but could not start the relauncher.\n\n{ex.Message}\n\nSee {Log.File}.",
                "Backdrop rebuild failed", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        // Graceful shutdown, not a hard kill — lets the Mutex, WebView2 profile, and log
        // close cleanly before the relauncher's Wait-Process unblocks.
        System.Windows.Application.Current.Dispatcher.Invoke(() => System.Windows.Application.Current.Shutdown());
    }

    /// <summary>
    /// Walks up from the running exe looking for build.ps1 (covers dist\Backdrop.exe
    /// directly), then falls back to BACKDROP_REPO_ROOT for an install location with no
    /// relationship to the repo. Never assumes the running exe's own path.
    /// </summary>
    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 6 && dir is not null; i++, dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "build.ps1"))) return dir.FullName;
        }

        string? env = Environment.GetEnvironmentVariable("BACKDROP_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(Path.Combine(env, "build.ps1")))
        {
            return Path.GetFullPath(env);
        }

        return null;
    }

    private static (int ExitCode, string Output) RunBuildScript(string repoRoot, string stagingPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-File");
        psi.ArgumentList.Add(Path.Combine(repoRoot, "build.ps1"));
        psi.ArgumentList.Add("-Output");
        psi.ArgumentList.Add(stagingPath);

        var output = new StringBuilder();
        using var process = new Process { StartInfo = psi };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) output.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) output.AppendLine(e.Data); };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        process.WaitForExit();

        return (process.ExitCode, output.ToString());
    }

    private static string Tail(string text, int lines = 40)
    {
        var all = text.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        return string.Join(Environment.NewLine, all.Length <= lines ? all : all[^lines..]);
    }

    /// <summary>
    /// A detached PowerShell helper that outlives this process: waits for this PID to fully
    /// exit (which is also what guarantees the single-instance Mutex is clear — mutex
    /// ownership is released automatically on process exit), retries the folder swap since
    /// WebView2's renderer subprocess can hold file locks briefly after the main PID is gone,
    /// then launches the new exe.
    /// </summary>
    private static void SpawnRelauncher(int pid, string stagingPath, string distPath)
    {
        string script = $$"""
            Wait-Process -Id {{pid}} -ErrorAction SilentlyContinue
            $ok = $false
            for ($i = 0; $i -lt 10; $i++) {
                try {
                    if (Test-Path '{{distPath}}') { Remove-Item -Recurse -Force '{{distPath}}' }
                    Move-Item '{{stagingPath}}' '{{distPath}}' -Force
                    $ok = $true
                    break
                } catch {
                    Start-Sleep -Milliseconds 300
                }
            }
            if ($ok) {
                Start-Process (Join-Path '{{distPath}}' '{{ExeName}}')
            }
            """;

        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-WindowStyle");
        psi.ArgumentList.Add("Hidden");
        psi.ArgumentList.Add("-EncodedCommand");
        psi.ArgumentList.Add(encoded);

        Process.Start(psi);
    }
}
