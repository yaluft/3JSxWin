using System.Runtime.InteropServices;

namespace Backdrop.Interop;

/// <summary>
/// A global, low-level keyboard hook that fires once each time a modifier chord is pressed.
/// The backdrop never holds focus, so RegisterHotKey and normal key events never reach it;
/// this hook sees the keyboard system-wide instead.
///
/// The chord is Ctrl+Alt+B by default. Each press toggles the on-scene console: the host
/// opens it and pins the scene interactive, or closes it and hands input back to the desktop.
/// Win+Shift+- triggers a dev-loop rebuild-and-relaunch instead.
/// </summary>
internal sealed class Hotkey : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12; // Alt
    private const int VK_SHIFT = 0x10;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_TRIGGER = 0x42; // 'B'
    private const int VK_OEM_4 = 0xDB; // [
    private const int VK_OEM_6 = 0xDD; // ]
    private const int VK_P = 0x50;
    private const int VK_OEM_MINUS = 0xBD; // -

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    // Kept alive as a field so the delegate is not collected while the hook holds it.
    private readonly HookProc _proc;
    private readonly Action _onPressed;
    private readonly Action<string> _onScene;
    private readonly Action _onRebuild;
    private IntPtr _hook;

    // Auto-repeat sends a stream of WM_KEYDOWNs while the key is held; only the first,
    // where the trigger was not already down, should count as a press.
    private bool _triggerDown;
    private uint _winChord;

    /// <param name="onPressed">
    /// Raised once per Ctrl+Alt+B. The hook runs on a system thread, so the handler must
    /// marshal to the UI thread itself.
    /// </param>
    /// <param name="onScene">Win+[ prev, Win+] next, Win+P shuffle.</param>
    /// <param name="onRebuild">Win+Shift+-. Also fires on a system thread.</param>
    internal Hotkey(Action onPressed, Action<string>? onScene = null, Action? onRebuild = null)
    {
        _onPressed = onPressed;
        _onScene = onScene ?? (_ => { });
        _onRebuild = onRebuild ?? (() => { });
        _proc = HookCallback;
    }

    internal void Start()
    {
        if (_hook != IntPtr.Zero) return;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);

            bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
            if (data.vkCode == VK_TRIGGER)
            {
                if (down && !_triggerDown)
                {
                    _triggerDown = true;
                    if (Held(VK_CONTROL) && Held(VK_MENU)) _onPressed();
                }
                else if (!down)
                {
                    _triggerDown = false;
                }
            }

            if (down && WinHeld() && data.vkCode == VK_OEM_MINUS && Held(VK_SHIFT) && _winChord != data.vkCode)
            {
                _winChord = data.vkCode;
                _onRebuild();
                return (IntPtr)1;
            }

            if (down && WinHeld() && data.vkCode is VK_OEM_4 or VK_OEM_6 or VK_P && _winChord != data.vkCode)
            {
                _winChord = data.vkCode;
                _onScene(data.vkCode == VK_OEM_4 ? "prev" : data.vkCode == VK_OEM_6 ? "next" : "shuffle");
                return (IntPtr)1;
            }
            if (!down && data.vkCode == _winChord) _winChord = 0;
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    private static bool Held(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private static bool WinHeld() => Held(VK_LWIN) || Held(VK_RWIN);

    public void Dispose()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }
}
