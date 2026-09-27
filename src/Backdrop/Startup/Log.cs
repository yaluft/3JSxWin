using System.IO;

namespace Backdrop.Startup;

/// <summary>
/// A wallpaper has no window to complain in, so problems go to a file instead.
/// %LOCALAPPDATA%\Backdrop\backdrop.log
/// </summary>
internal static class Log
{
    // One lock for all writes: multiple monitors = multiple windows on threads
    // that may all log at once; without this the file lines would interleave.
    private static readonly object Gate = new();

    // %LOCALAPPDATA%\Backdrop  — per-user, no admin rights needed to write here.
    internal static string Folder { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Backdrop");

    internal static string File { get; } = Path.Combine(Folder, "backdrop.log");

    internal static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Folder);

                // Self-trimming log: once it passes 512 KB, delete and start
                // fresh. Simpler than rotating files and the old lines are rarely useful.
                var info = new FileInfo(File);
                if (info.Exists && info.Length > 512 * 1024) info.Delete();

                // One timestamped line, appended. "yyyy-MM-dd HH:mm:ss" so lines sort.
                System.IO.File.AppendAllText(File, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging must never be the thing that takes the app down.
        }
    }

    // Overload for exceptions: flattens type + message + stack onto the line.
    internal static void Write(string context, Exception ex) =>
        Write($"{context}: {ex.GetType().Name}: {ex.Message}{Environment.NewLine}{ex.StackTrace}");
}
