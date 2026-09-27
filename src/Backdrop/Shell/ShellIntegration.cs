// ShellIntegration.cs — everything Backdrop writes into the Windows shell so it
// feels installed: a 3jsxwin: URL protocol, a right-click item on the desktop,
// a .theme file under Personalization, a screensaver path, and the Startup
// shortcut. All of it lives under HKCU / the user profile so we never need admin.

using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Backdrop.Startup;
using Microsoft.Win32;

namespace Backdrop.Shell;

/// <summary>
/// The hooks a Win32/WPF app can actually register. There is no public API to add a
/// fourth Background type in Settings → Personalization, so this covers the real
/// surfaces: a desktop context-menu item, a .theme under Personalization → Themes,
/// a screensaver path (HKCU; not the System32 picker), a 3jsxwin: protocol, and
/// the existing Startup-folder shortcut.
/// </summary>
internal static class ShellIntegration
{
    // Key paths. Everything is under Software\Classes in HKCU rather than HKLM:
    // the per-user hive needs no elevation, and the shell merges HKCU\Software\Classes
    // over HKLM's on top for the current user, so a user-scoped write behaves the same.
    //   MenuKey     — the desktop right-click ("DesktopBackground") verb container.
    //   ProtocolKey — the 3jsxwin: URL scheme handler.
    //   ThemeGuid   — a stable id stamped into the .theme so Windows treats reapplies
    //                 as the same theme instead of piling up "3JSxWin (2)" entries.
    internal const string ProtocolName = "3jsxwin";
    private const string MenuKey = @"Software\Classes\DesktopBackground\Shell\3JSxWin";
    private const string ProtocolKey = @"Software\Classes\" + ProtocolName;
    private const string ThemeGuid = "{3A5B7C91-8E2F-4D11-9A44-7B2C1D0E5F33}";

    // CreateHardLink lets us expose the running exe under a ".scr" name without
    // copying the whole binary. A hard link is a second directory entry for the
    // same file data, so the "screensaver" and the app stay byte-identical and
    // update together. Both paths must be on the same NTFS volume for this to work.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    // The full path to our own exe, baked into every registry command string.
    // Environment.ProcessPath is the real launched image; the BaseDirectory
    // fallback covers odd hosts (e.g. a test runner) where ProcessPath is null.
    internal static string ExePath =>
        Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "Backdrop.exe");

    // %AppData%\Microsoft\Windows\Start Menu\Programs\Startup\Backdrop.lnk —
    // a shortcut dropped here is auto-launched at logon by Explorer, no admin
    // and no Run-key registry write needed.
    internal static string StartupLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Backdrop.lnk");

    // %LocalAppData%\Microsoft\Windows\Themes\3JSxWin.theme — the per-user Themes
    // folder that Personalization → Themes scans. The machine-wide copy under
    // %SystemRoot%\Resources\Themes would need admin.
    internal static string ThemePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "Windows", "Themes", "3JSxWin.theme");

    // A ".scr" alias sitting next to the exe in the install folder. Windows only
    // treats a file as a screensaver by its .scr extension, so we need this name
    // even though it is the same binary.
    internal static string ScreensaverPath =>
        Path.Combine(AppContext.BaseDirectory, "3JSxWin.scr");

    // One call that wires up every shell surface. Run on each startup: the writes
    // are idempotent (CreateSubKey opens-or-creates), so this doubles as a self-heal
    // if the user's registry got cleaned or the exe moved to a new folder.
    // Any failure is logged and swallowed — shell integration is a nice-to-have,
    // never a reason to block the backdrop from rendering.
    internal static void Register()
    {
        try
        {
            RegisterProtocol();
            RegisterDesktopMenu();
            WriteTheme();
            RegisterScreensaverFile();
            Log.Write("Shell integration registered (protocol, desktop menu, theme, screensaver path).");
        }
        catch (Exception ex)
        {
            Log.Write("Shell integration", ex);
        }
    }

    // Turn "launch at logon" on or off by creating or deleting the .lnk in the
    // Startup folder. We build the shortcut through the WScript.Shell COM object
    // (IWshShortcut) because .NET has no built-in .lnk writer — a .lnk is a binary
    // Shell Link structure, not a text file, so COM is the sane way to author one.
    internal static void SetStartup(bool enabled)
    {
        try
        {
            // Off: just remove the shortcut. Explorer stops launching us next logon.
            if (!enabled)
            {
                if (File.Exists(StartupLink)) File.Delete(StartupLink);
                Log.Write("Startup shortcut removed.");
                return;
            }

            // Late-bind to the WScript.Shell COM class by its ProgID. Type.GetTypeFromProgID
            // + Activator.CreateInstance avoids a compile-time Interop reference; `dynamic`
            // then lets us call CreateShortcut / set properties without the typed interface.
            Type? type = Type.GetTypeFromProgID("WScript.Shell");
            if (type is null) throw new InvalidOperationException("WScript.Shell unavailable.");
            dynamic shell = Activator.CreateInstance(type)!;

            // CreateShortcut on an existing path opens it for editing; on a new path
            // it creates a fresh one. Nothing is written to disk until .Save().
            dynamic shortcut = shell.CreateShortcut(StartupLink);
            shortcut.TargetPath = ExePath;
            shortcut.Arguments = "";
            // WorkingDirectory matters: the app resolves the web/ scene folder and
            // config.json relative to it, so point it at the install folder.
            shortcut.WorkingDirectory = Path.GetDirectoryName(ExePath) ?? AppContext.BaseDirectory;
            shortcut.Description = "three.js backdrop for the Windows desktop";
            shortcut.Save();
            Log.Write($"Startup shortcut: {StartupLink}");
        }
        catch (Exception ex)
        {
            Log.Write("Startup shortcut", ex);
        }
    }

    // The Startup shortcut is our single source of truth for "launch at logon",
    // so the tray checkbox just asks whether the file is there.
    internal static bool IsStartupEnabled() => File.Exists(StartupLink);

    // Deep-link straight to Settings → Personalization → Background. "ms-settings:" is
    // a shell protocol, so UseShellExecute=true is required — that hands the string to
    // the shell to resolve, instead of trying to exec it as a file path.
    internal static void OpenWindowsBackgroundSettings()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:personalization-background",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Write("Could not open Windows background settings", ex);
        }
    }

    // The screensaver settings dialog was never ported to the Settings app. We open
    // the legacy control panel applet directly: desk.cpl is the display applet and
    // ",,1" selects its second tab (index is 0-based) — the Screen Saver page.
    internal static void OpenScreensaverSettings()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "control.exe",
                Arguments = "desk.cpl,,1",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Write("Could not open screensaver settings", ex);
        }
    }

    /// <summary>
    /// Points HKCU ScreenSaveActive at our .scr (or exe) without requiring admin / System32.
    /// The Win11 screensaver picker still only lists System32 .scr files — that list cannot
    /// be extended from user space.
    /// </summary>
    internal static void EnableScreensaver()
    {
        try
        {
            // HKCU\Control Panel\Desktop is where the screensaver settings actually
            // live — the System32 picker only edits these same values. Writing them
            // ourselves activates any .scr on disk, bypassing the picker's whitelist.
            //   SCRNSAVE.EXE     — full path to the screensaver to run.
            //   ScreenSaveActive — "1" arms the idle timer (timeout is a sibling value).
            string scr = RegisterScreensaverFile();
            using RegistryKey desk = Registry.CurrentUser.CreateSubKey(@"Control Panel\Desktop");
            desk.SetValue("SCRNSAVE.EXE", scr);
            desk.SetValue("ScreenSaveActive", "1");
            Log.Write($"Screensaver set to {scr}");
        }
        catch (Exception ex)
        {
            Log.Write("Screensaver registration", ex);
        }
    }

    // Registers the "3jsxwin:" URL scheme so links like 3jsxwin:window or
    // 3jsxwin:settings launch us. Lives at HKCU\Software\Classes\3jsxwin.
    private static void RegisterProtocol()
    {
        using RegistryKey root = Registry.CurrentUser.CreateSubKey(ProtocolKey);
        // The (Default) value is the friendly type name. The empty-string "URL Protocol"
        // value is the actual flag: its mere presence tells the shell this class is a
        // URL scheme and not a file type, so ShellExecute will route URLs to it.
        root.SetValue("", "URL:3JSxWin Protocol");
        root.SetValue("URL Protocol", "");
        // Icon shown next to the link in some UIs. ",0" = first icon resource in the exe.
        using (RegistryKey icon = root.CreateSubKey("DefaultIcon"))
            icon.SetValue("", $"\"{ExePath}\",0");
        // shell\open\command is the launch template. %1 is substituted with the whole
        // URL; the surrounding quotes keep a URL with spaces as one argv entry.
        using RegistryKey cmd = root.CreateSubKey(@"shell\open\command");
        cmd.SetValue("", $"\"{ExePath}\" \"%1\"");
    }

    // Adds a "3JSxWin" fly-out to the right-click menu on the desktop wallpaper.
    // The key is HKCU\Software\Classes\DesktopBackground\Shell\<name>: DesktopBackground
    // is the shell class for "right-clicked the desktop itself" (as opposed to an icon).
    private static void RegisterDesktopMenu()
    {
        // The container key. MUIVerb is the label; setting it plus a "shell" subkey of
        // sub-items is what turns this entry into a cascading submenu. Position=Bottom
        // asks the shell to sort it near the end of the menu.
        using (RegistryKey root = Registry.CurrentUser.CreateSubKey(MenuKey))
        {
            root.SetValue("MUIVerb", "3JSxWin");
            root.SetValue("Icon", ExePath);
            root.SetValue("Position", "Bottom");
        }

        // Each sub-item is a key under ...\shell with an MUIVerb label, and a
        // \command child whose (Default) value is the exact command line to run.
        // The flags here (--desktop, --window, --console) are parsed by CommandLineOptions.

        // "Set as desktop background" — attach the live scene to the WorkerW layer.
        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\desktop"))
        {
            item.SetValue("MUIVerb", "Set as desktop background");
            item.SetValue("Icon", ExePath);
        }
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\desktop\command"))
            cmd.SetValue("", $"\"{ExePath}\" --desktop");

        // "Preview in a window" — run it as an ordinary resizable window instead.
        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\window"))
            item.SetValue("MUIVerb", "Preview in a window");
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\window\command"))
            cmd.SetValue("", $"\"{ExePath}\" --window");

        // "3JSxWin settings" — open the settings/console panel.
        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\settings"))
            item.SetValue("MUIVerb", "3JSxWin settings");
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\settings\command"))
            cmd.SetValue("", $"\"{ExePath}\" --console");
    }

    // Writes the companion .theme file. A .theme is just an INI: dropping one in the
    // per-user Themes folder makes it show up under Personalization → Themes, where the
    // user can click it. It can't spawn our live scene directly — a theme only sets
    // static shell values — so it sets a dark solid wallpaper colour that blends with
    // the scene, plus dark mode. The one launch path a theme does have is the [Boot]
    // section: applying the theme points the OS screensaver at our hard-linked
    // 3JSxWin.scr and arms it, so Windows itself starts Backdrop.exe in screensaver
    // mode after the idle timeout. Backdrop.exe still has to be running for the live
    // wallpaper animation.
    private static void WriteTheme()
    {
        string dir = Path.GetDirectoryName(ThemePath)!;
        Directory.CreateDirectory(dir);
        // Make sure the .scr alias exists before referencing it in [Boot]; falls back to
        // the exe path if the hard link can't be created (different volume, etc.).
        string scr = RegisterScreensaverFile();
        // Section by section: [Theme] name + our stable ThemeId; [Control Panel\Desktop]
        // clears any wallpaper image and arms the screensaver timer; [Boot] points
        // SCRNSAVE.EXE at our .scr so applying the theme activates it; [Control
        // Panel\Colors] Background is the RGB fill shown behind the desktop;
        // [VisualStyles] SystemMode/AppMode=1 forces dark.
        string[] lines =
        [
            "; 3JSxWin companion theme (dark colours). Applying it sets a solid",
            "; wallpaper colour and arms the 3JSxWin screensaver; the live scene still",
            "; comes from Backdrop.exe on WorkerW.",
            "[Theme]",
            "DisplayName=3JSxWin",
            "ThemeId=" + ThemeGuid,
            "SetLogonBackground=0",
            "",
            @"[Control Panel\Desktop]",
            "Wallpaper=",
            "TileWallpaper=0",
            "WallpaperStyle=0",
            "Pattern=",
            "ScreenSaveActive=1",
            "",
            @"[Control Panel\Colors]",
            "Background=4 6 12",
            "",
            "[Boot]",
            "SCRNSAVE.EXE=" + scr,
            "",
            "[VisualStyles]",
            @"Path=%SystemRoot%\resources\themes\Aero\Aero.msstyles",
            "ColorStyle=NormalColor",
            "Size=NormalSize",
            "AutoColorization=0",
            "ColorizationColor=0xC46E5BFF",
            "SystemMode=1",
            "AppMode=1",
            "",
            "[MasterThemeSelector]",
            "MTSM=DABJDKT",
        ];
        File.WriteAllText(ThemePath, string.Join(Environment.NewLine, lines) + Environment.NewLine);
    }

    // Makes sure a "*.scr" copy of the exe exists and returns the path to use as the
    // screensaver. We hard-link rather than File.Copy so the two never drift apart and
    // we don't waste ~150 MB on a duplicate. If linking fails (different volume, FS that
    // doesn't support it, permissions), we fall back to just pointing at the .exe —
    // Windows will still run it as a screensaver, it only insisted on the .scr name in
    // the picker UI, not when the registry value is written directly.
    private static string RegisterScreensaverFile()
    {
        string exe = ExePath;
        string scr = ScreensaverPath;
        try
        {
            if (!File.Exists(scr))
            {
                if (!CreateHardLink(scr, exe, IntPtr.Zero))
                {
                    return exe;
                }
            }
            return File.Exists(scr) ? scr : exe;
        }
        catch (Exception ex)
        {
            Log.Write("Screensaver hardlink", ex);
            return exe;
        }
    }
}
