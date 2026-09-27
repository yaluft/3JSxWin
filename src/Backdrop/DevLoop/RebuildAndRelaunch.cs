// RebuildAndRelaunch.cs — the Win+Shift+- developer inner loop.
// Rebuilds the repo into a staging folder, then hands the running exe off to a
// detached PowerShell script that swaps the new build in and restarts once we exit.
// Only used on a dev box where Backdrop.exe is running out of a clone of the repo.

using System.Diagnostics;
using System.IO;
using System.Text;
using Backdrop.Startup;

// WPF and WinForms both define these names; we run in a WPF app, so alias the
// System.Windows ones so an unqualified MessageBox.Show is unambiguous.
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
    // build.ps1 -Output writes here; the relauncher renames this to "dist" after we quit.
    private const string StagingFolderName = "dist.new";
    private const string DistFolderName = "dist";
    private const string ExeName = "Backdrop.exe";

    // A build takes a few seconds; guard against a second hotkey press stacking a
    // parallel build on top of the first.
    private bool _inFlight;

    internal void Trigger()
    {
        if (_inFlight)
        {
            Log.Write("Rebuild hotkey pressed while a build is already in flight; ignored.");
            return;
        }
        _inFlight = true;

        // Run off the UI thread so the wallpaper keeps animating while MSBuild runs.
        // ContinueWith clears the flag whether the build succeeded, threw, or was cancelled.
        Task.Run(RunAsync).ContinueWith(_ => _inFlight = false);
    }

    private static void RunAsync()
    {
        Log.Write("Rebuild hotkey pressed.");

        // No repo -> nothing to rebuild. This is the normal case for an installed copy,
        // so we log and bail quietly rather than showing an error dialog.
        string? repoRoot = FindRepoRoot();
        if (repoRoot is null)
        {
            Log.Write("Rebuild hotkey: could not locate build.ps1 (walked up from " +
                      $"{AppContext.BaseDirectory} and checked BACKDROP_REPO_ROOT). Nothing to do.");
            return;
        }

        string stagingPath = Path.Combine(repoRoot, StagingFolderName);
        string distPath = Path.Combine(repoRoot, DistFolderName);

        // Build into dist.new. If this fails we stop here — dist\ (what we're running
        // from) is never touched, so a compile error just leaves the wallpaper alone.
        var (exitCode, output) = RunBuildScript(repoRoot, stagingPath);
        if (exitCode != 0)
        {
            Log.Write($"Rebuild failed (exit {exitCode}). Output tail:{Environment.NewLine}{Tail(output)}");
            MessageBox.Show(
                $"Backdrop rebuild failed (exit {exitCode}).\n\nSee {Log.File} for the full build output.\n\n{stagingPath} left in place for inspection.",
                "Backdrop rebuild failed", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        // Belt and braces: build.ps1 can exit 0 but still not produce an exe (e.g. it
        // published to the wrong folder). Verify the artifact before we commit to quitting.
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

        // Start the detached swapper first, and only shut down if it actually launched.
        // If Process.Start throws, we stay running on the old build — annoying, but safe.
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
        // Walk up at most 6 levels from wherever the exe lives. build.ps1 sits at the
        // repo root, so from repo\dist\Backdrop.exe it's two hops up; the extra levels
        // cover deeper publish layouts (repo\src\Backdrop\bin\Debug\net8.0-windows\...).
        // We probe for the FILE, not the exe's path, so a copied-out build won't match.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 6 && dir is not null; i++, dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "build.ps1"))) return dir.FullName;
        }

        // Escape hatch for when the exe lives nowhere near the repo (installed to
        // Program Files, say, but you still want the hotkey to rebuild your checkout).
        // Point BACKDROP_REPO_ROOT at the clone and we build/relaunch from there.
        string? env = Environment.GetEnvironmentVariable("BACKDROP_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(Path.Combine(env, "build.ps1")))
        {
            return Path.GetFullPath(env);
        }

        return null;
    }

    // Runs build.ps1 synchronously and returns its exit code plus the combined
    // stdout+stderr. We're already on a background thread here, so blocking is fine.
    private static (int ExitCode, string Output) RunBuildScript(string repoRoot, string stagingPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,   // required so we can redirect the pipes below
            CreateNoWindow = true,     // no console flash on the desktop
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        // -NoProfile: don't run the user's PS profile (faster, no surprises).
        // -NonInteractive: fail instead of prompting if the script asks a question.
        // -ExecutionPolicy Bypass: this-process-only, so an unsigned build.ps1 still runs.
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-File");
        psi.ArgumentList.Add(Path.Combine(repoRoot, "build.ps1"));
        psi.ArgumentList.Add("-Output");
        psi.ArgumentList.Add(stagingPath);

        // Drain both pipes on background threads (BeginXxxReadLine). Reading them
        // synchronously risks a deadlock if one pipe's buffer fills while we wait on the other.
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

    // Last N lines of the build output — the full log goes to Log.File, but the
    // error dialog and the log line only want the tail where the actual failure is.
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
        // $$""" is a C# raw interpolated string with a DOUBLED delimiter: {{pid}} is a
        // C# hole, but single { } (the PowerShell for-loop braces) are literal. So this
        // block is the actual PS script, with our three values baked in as literals.
        //
        // The script, step by step:
        //  1. Wait-Process blocks until our PID is fully gone. That exit is also what
        //     releases the single-instance Mutex and unlocks the old dist\ files.
        //  2. Retry loop: WebView2's msedgewebview2 children can keep a lock on files
        //     under dist\ for a fraction of a second after our main process dies, so
        //     the delete/move can fail once or twice — back off 300ms and try again.
        //  3. Move dist.new -> dist, then start the fresh exe. If all 10 attempts fail
        //     we do NOT start anything, leaving dist.new for you to swap by hand.
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

        // -EncodedCommand takes base64 of UTF-16LE (Encoding.Unicode). Passing the
        // script this way sidesteps every quoting headache with paths that contain
        // spaces or quotes — no arg-parsing of the script body at all.
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

        // Fire and forget. We deliberately don't hold the returned Process — this
        // child must outlive us, since its whole job is to wait for us to exit.
        Process.Start(psi);
    }
}
