using System.IO;

namespace Backdrop.Startup;

/// <summary>
/// Remembers the tray "Desktop layout" pick across launches. CLI flags still win.
/// </summary>
internal static class DesktopLayoutSettings
{
    // Plain-text file next to the log. One word: "SpanAll" / "Duplicate" / "Single".
    private static string Path => System.IO.Path.Combine(Log.Folder, "layout.txt");

    // Returns null if the file is missing or unreadable, which ResolveMode treats
    // as "no saved preference, use the default".
    internal static LayoutMode? Load()
    {
        try
        {
            if (!File.Exists(Path)) return null;

            // nameof(LayoutMode.SpanAll) is the compile-time string "SpanAll" —
            // stays in sync with the enum automatically if it's ever renamed.
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

    // Called from the tray menu when the user picks a layout.
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
