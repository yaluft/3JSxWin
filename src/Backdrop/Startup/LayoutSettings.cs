using System.IO;

namespace Backdrop.Startup;

/// <summary>
/// Remembers the tray "Desktop layout" pick across launches. CLI flags still win.
/// </summary>
internal static class DesktopLayoutSettings
{
    private static string Path => System.IO.Path.Combine(Log.Folder, "layout.txt");

    internal static LayoutMode? Load()
    {
        try
        {
            if (!File.Exists(Path)) return null;
            return File.ReadAllText(Path).Trim() switch
            {
                nameof(LayoutMode.SpanAll) => LayoutMode.SpanAll,
                nameof(LayoutMode.Duplicate) => LayoutMode.Duplicate,
                nameof(LayoutMode.Single) => LayoutMode.Single,
                _ => null
            };
        }
        catch
        {
            return null;
        }
    }

    internal static void Save(LayoutMode mode)
    {
        try
        {
            Directory.CreateDirectory(Log.Folder);
            File.WriteAllText(Path, mode.ToString());
        }
        catch (Exception ex)
        {
            Log.Write("Could not save layout", ex);
        }
    }
}
