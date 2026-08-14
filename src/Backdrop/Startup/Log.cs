using System.IO;

namespace Backdrop.Startup;

/// <summary>
/// A wallpaper has no window to complain in, so problems go to a file instead.
/// %LOCALAPPDATA%\Backdrop\backdrop.log
/// </summary>
internal static class Log
{
    private static readonly object Gate = new();

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
                var info = new FileInfo(File);
                if (info.Exists && info.Length > 512 * 1024) info.Delete();
                System.IO.File.AppendAllText(File, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging must never be the thing that takes the app down.
        }
    }

    internal static void Write(string context, Exception ex) => Write($"{context}: {ex.GetType().Name}: {ex.Message}");
}
