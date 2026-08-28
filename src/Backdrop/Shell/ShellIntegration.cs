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
    internal const string ProtocolName = "3jsxwin";
    private const string MenuKey = @"Software\Classes\DesktopBackground\Shell\3JSxWin";
    private const string ProtocolKey = @"Software\Classes\" + ProtocolName;
    private const string ThemeGuid = "{3A5B7C91-8E2F-4D11-9A44-7B2C1D0E5F33}";

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    internal static string ExePath =>
        Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "Backdrop.exe");

    internal static string StartupLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Backdrop.lnk");

    internal static string ThemePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "Windows", "Themes", "3JSxWin.theme");

    internal static string ScreensaverPath =>
        Path.Combine(AppContext.BaseDirectory, "3JSxWin.scr");

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

    internal static void SetStartup(bool enabled)
    {
        try
        {
            if (!enabled)
            {
                if (File.Exists(StartupLink)) File.Delete(StartupLink);
                Log.Write("Startup shortcut removed.");
                return;
            }

            Type? type = Type.GetTypeFromProgID("WScript.Shell");
            if (type is null) throw new InvalidOperationException("WScript.Shell unavailable.");
            dynamic shell = Activator.CreateInstance(type)!;
            dynamic shortcut = shell.CreateShortcut(StartupLink);
            shortcut.TargetPath = ExePath;
            shortcut.Arguments = "";
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

    internal static bool IsStartupEnabled() => File.Exists(StartupLink);

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

    private static void RegisterProtocol()
    {
        using RegistryKey root = Registry.CurrentUser.CreateSubKey(ProtocolKey);
        root.SetValue("", "URL:3JSxWin Protocol");
        root.SetValue("URL Protocol", "");
        using (RegistryKey icon = root.CreateSubKey("DefaultIcon"))
            icon.SetValue("", $"\"{ExePath}\",0");
        using RegistryKey cmd = root.CreateSubKey(@"shell\open\command");
        cmd.SetValue("", $"\"{ExePath}\" \"%1\"");
    }

    private static void RegisterDesktopMenu()
    {
        using (RegistryKey root = Registry.CurrentUser.CreateSubKey(MenuKey))
        {
            root.SetValue("MUIVerb", "3JSxWin");
            root.SetValue("Icon", ExePath);
            root.SetValue("Position", "Bottom");
        }

        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\desktop"))
        {
            item.SetValue("MUIVerb", "Set as desktop background");
            item.SetValue("Icon", ExePath);
        }
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\desktop\command"))
            cmd.SetValue("", $"\"{ExePath}\" --desktop");

        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\window"))
            item.SetValue("MUIVerb", "Preview in a window");
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\window\command"))
            cmd.SetValue("", $"\"{ExePath}\" --window");

        using (RegistryKey item = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\settings"))
            item.SetValue("MUIVerb", "3JSxWin settings");
        using (RegistryKey cmd = Registry.CurrentUser.CreateSubKey(MenuKey + @"\shell\settings\command"))
            cmd.SetValue("", $"\"{ExePath}\" --console");
    }

    private static void WriteTheme()
    {
        string dir = Path.GetDirectoryName(ThemePath)!;
        Directory.CreateDirectory(dir);
        string[] lines =
        [
            "; 3JSxWin companion theme (dark colours). Applying it sets a solid",
            "; wallpaper colour; the live scene still comes from Backdrop.exe on WorkerW.",
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
            "",
            @"[Control Panel\Colors]",
            "Background=4 6 12",
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
