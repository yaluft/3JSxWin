// CommandLineOptions.cs — turns the raw string[] args into a typed options object.
// Also decides desktop layout (ResolveMode) and builds the page query string.

using System.Globalization;

namespace Backdrop.Startup;

// How the scene covers the monitors.
//   Single    = one window on one monitor
//   SpanAll   = one window stretched across every monitor (one scene, one audio graph)
//   Duplicate = a separate window+scene per monitor, each at native resolution
internal enum LayoutMode
{
    Single,
    SpanAll,
    Duplicate,
}

internal sealed class CommandLineOptions
{
    // Every flag becomes one property. "private set" = only Parse() can fill these.
    internal bool Windowed { get; private set; }
    internal bool SpanAll { get; private set; }
    internal bool DuplicateAll { get; private set; }
    internal int MonitorIndex { get; private set; } = -1;   // -1 = "not specified"
    internal int? Fps { get; private set; }                 // null = use config.json
    internal double? RenderScale { get; private set; }
    internal bool DevTools { get; private set; }
    internal string? SceneFolder { get; private set; }
    internal string? ThemeId { get; private set; }
    internal bool Diagnose { get; private set; }
    internal bool ShowHelp { get; private set; }
    internal bool ForceDesktop { get; private set; }
    internal bool OpenConsole { get; private set; }
    internal bool ScreensaverRun { get; private set; }      // "/s"
    internal bool ScreensaverConfig { get; private set; }   // "/c"
    internal bool ScreensaverPreview { get; private set; }  // "/p"
    internal string? Protocol { get; private set; }         // the "3jsxwin:..." URL, if any

    // Launches triggered by the shell (protocol, screensaver, --console) should
    // fail silently if Backdrop is already running, instead of popping a dialog.
    internal bool QuietIfRunning => ForceDesktop || OpenConsole || ScreensaverRun
        || ScreensaverConfig || ScreensaverPreview || Protocol is not null;

    // Shown by --help. Raw string literal ("""...""") so no escaping needed.
    internal const string Usage = """
        Backdrop - a three.js scene living behind your desktop icons.

          --window            Run in a normal resizable window instead of on the desktop.
          --span-all          Treat every monitor as one continuous canvas.
          --duplicate-all     Same scene on every monitor, each at native resolution.
          --monitor <n>       Cover monitor <n> only (0-based, ordered left to right).
          --fps <n>           Override the frame cap (1-144).
          --scale <f>         Override render scale (0.4-1.0). Lower is cheaper.
          --scene <path>      Load a different web folder instead of the bundled one.
          --theme <id>        Boot a catalog theme (e.g. night-field, starnode).
          --devtools          Enable DevTools (F12 in --window mode).
          --diagnose          Report what the shell's desktop windows look like, then exit.
          --desktop           Attach to the desktop wallpaper layer (WorkerW).
          --console           Open the settings panel after start.
          --help              Show this text.

        While Backdrop runs it owns the Copilot entry points: Win+C and the
        Copilot keyboard key both open Comms (Ctrl+Alt+C is a no-Copilot
        fallback). Win+[ / Win+] / Win+P cycle scenes; Ctrl+Alt+B toggles
        this settings panel.

        Also handles 3jsxwin: URLs, and screensaver flags /s /c /p.
        """;

    internal static CommandLineOptions Parse(string[] args)
    {
        var o = new CommandLineOptions();

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i].Trim();

            // Local helper: grab the NEXT arg as this flag's value, advancing i.
            string? Next() => i + 1 < args.Length ? args[++i] : null;

            // A "3jsxwin:..." URL (from the registered protocol handler) is a
            // whole arg on its own; hand it to ApplyProtocol.
            if (a.StartsWith("3jsxwin:", StringComparison.OrdinalIgnoreCase))
            {
                ApplyProtocol(o, a);
                continue;
            }

            string flag = a.ToLowerInvariant();

            // Windows screensaver verbs. "/s" run, "/c" configure, "/p" preview.
            // Note "/c" can arrive as "/c:1234" (config parent hwnd), hence StartsWith.
            if (flag is "/s" or "-s")
            {
                o.ScreensaverRun = true;
                o.Windowed = true;   // screensaver draws in a full-screen window, not on WorkerW
                continue;
            }
            if (flag.StartsWith("/c") || flag.StartsWith("-c"))
            {
                o.ScreensaverConfig = true;
                o.OpenConsole = true;
                o.Windowed = true;
                continue;
            }
            if (flag is "/p" or "-p")
            {
                o.ScreensaverPreview = true;
                Next(); // the preview HWND — we consume it but don't draw into it
                continue;
            }

            // The normal "--flag" options.
            switch (flag)
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
                    // Clamp to a sane range so a typo can't ask for 100000 fps.
                    if (int.TryParse(Next(), out int f)) o.Fps = Math.Clamp(f, 1, 144);
                    break;
                case "--scale":
                    // InvariantCulture so "0.5" parses regardless of the user's locale
                    // (some locales use "," as the decimal separator).
                    if (double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out double s))
                        o.RenderScale = Math.Clamp(s, 0.4, 1.0);
                    break;
                case "--scene":
                    o.SceneFolder = Next();
                    break;
                case "--theme":
                    o.ThemeId = Next();
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
                case "--desktop":
                    o.ForceDesktop = true;
                    o.Windowed = false;
                    break;
                case "--console":
                    o.OpenConsole = true;
                    break;
            }
        }

        return o;
    }

    // Parses "3jsxwin:window" / "3jsxwin:settings" / anything else -> desktop.
    // Strips the "scheme:" and any leading slashes, then matches on the verb.
    private static void ApplyProtocol(CommandLineOptions o, string url)
    {
        o.Protocol = url;
        string rest = url;
        int sep = url.IndexOf(':');
        if (sep >= 0) rest = url[(sep + 1)..];
        rest = rest.TrimStart('/').ToLowerInvariant();
        if (rest.StartsWith("window")) o.Windowed = true;
        else if (rest.StartsWith("settings") || rest.StartsWith("console")) o.OpenConsole = true;
        else
        {
            o.ForceDesktop = true;
            o.Windowed = false;
        }
    }

    /// <summary>
    /// Desktop layout for this launch. An explicit flag wins, then the last tray pick,
    /// then SpanAll when more than one monitor is present, so a dual-screen box gets one
    /// continuous scene (and one audio graph). Duplicate used to be the unset default,
    /// which opened one WebView2 per monitor. Duplicate is still a tray click away.
    /// </summary>
    internal LayoutMode ResolveMode(int screenCount)
    {
        // Priority order, most explicit first.
        if (DuplicateAll) return LayoutMode.Duplicate;
        if (SpanAll) return LayoutMode.SpanAll;
        if (MonitorIndex >= 0) return LayoutMode.Single;
        if (DesktopLayoutSettings.Load() is LayoutMode saved) return saved;   // last tray pick
        return screenCount > 1 ? LayoutMode.SpanAll : LayoutMode.Single;      // sensible default
    }

    /// <summary>Overrides handed to the page as a query string; config.json supplies the rest.</summary>
    internal string ToQueryString()
    {
        // Only CLI overrides go in the URL. The page reads config.json for everything else.
        var parts = new List<string>();
        if (Fps is int fps) parts.Add($"fps={fps}");
        if (RenderScale is double scale) parts.Add($"scale={scale.ToString("0.###", CultureInfo.InvariantCulture)}");
        if (Windowed) parts.Add("mode=window");
        if (!string.IsNullOrWhiteSpace(ThemeId)) parts.Add("scene=" + Uri.EscapeDataString(ThemeId));
        return parts.Count == 0 ? string.Empty : "?" + string.Join("&", parts);
    }
}
