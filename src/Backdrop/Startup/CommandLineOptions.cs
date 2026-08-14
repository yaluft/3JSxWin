using System.Globalization;

namespace Backdrop.Startup;

internal enum LayoutMode
{
    Single,
    SpanAll,
    Duplicate,
}

internal sealed class CommandLineOptions
{
    internal bool Windowed { get; private set; }
    internal bool SpanAll { get; private set; }
    internal bool DuplicateAll { get; private set; }
    internal int MonitorIndex { get; private set; } = -1;
    internal int? Fps { get; private set; }
    internal double? RenderScale { get; private set; }
    internal bool DevTools { get; private set; }
    internal string? SceneFolder { get; private set; }
    internal bool Diagnose { get; private set; }
    internal bool ShowHelp { get; private set; }

    internal const string Usage = """
        Backdrop - a three.js scene living behind your desktop icons.

          --window            Run in a normal resizable window instead of on the desktop.
          --span-all          Treat every monitor as one continuous canvas.
          --duplicate-all     Same scene on every monitor, each at native resolution.
          --monitor <n>       Cover monitor <n> only (0-based, ordered left to right).
          --fps <n>           Override the frame cap (1-144).
          --scale <f>         Override render scale (0.4-1.0). Lower is cheaper.
          --scene <path>      Load a different web folder instead of the bundled one.
          --devtools          Enable DevTools (F12 in --window mode).
          --diagnose          Report what the shell's desktop windows look like, then exit.
          --help              Show this text.
        """;

    internal static CommandLineOptions Parse(string[] args)
    {
        var o = new CommandLineOptions();

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i].Trim();
            string? Next() => i + 1 < args.Length ? args[++i] : null;

            switch (a.ToLowerInvariant())
            {
                case "--window" or "-w":
                    o.Windowed = true;
                    break;
                case "--span-all":
                    o.SpanAll = true;
                    break;
                case "--duplicate-all":
                    o.DuplicateAll = true;
                    break;
                case "--monitor":
                    if (int.TryParse(Next(), out int m)) o.MonitorIndex = m;
                    break;
                case "--fps":
                    if (int.TryParse(Next(), out int f)) o.Fps = Math.Clamp(f, 1, 144);
                    break;
                case "--scale":
                    if (double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out double s))
                        o.RenderScale = Math.Clamp(s, 0.4, 1.0);
                    break;
                case "--scene":
                    o.SceneFolder = Next();
                    break;
                case "--devtools":
                    o.DevTools = true;
                    break;
                case "--diagnose":
                    o.Diagnose = true;
                    break;
                case "--help" or "-h" or "/?":
                    o.ShowHelp = true;
                    break;
            }
        }

        return o;
    }

    /// <summary>
    /// Desktop layout for this launch. An explicit flag wins, then the last tray pick,
    /// then Duplicate when more than one monitor is present so a dual-screen box is
    /// covered without having to remember --duplicate-all.
    /// </summary>
    internal LayoutMode ResolveMode(int screenCount)
    {
        if (DuplicateAll) return LayoutMode.Duplicate;
        if (SpanAll) return LayoutMode.SpanAll;
        if (MonitorIndex >= 0) return LayoutMode.Single;
        if (DesktopLayoutSettings.Load() is LayoutMode saved) return saved;
        return screenCount > 1 ? LayoutMode.Duplicate : LayoutMode.Single;
    }

    /// <summary>Overrides handed to the page as a query string; config.json supplies the rest.</summary>
    internal string ToQueryString()
    {
        var parts = new List<string>();
        if (Fps is int fps) parts.Add($"fps={fps}");
        if (RenderScale is double scale) parts.Add($"scale={scale.ToString("0.###", CultureInfo.InvariantCulture)}");
        if (Windowed) parts.Add("mode=window");
        return parts.Count == 0 ? string.Empty : "?" + string.Join("&", parts);
    }
}
