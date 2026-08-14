using System.Runtime.InteropServices;

namespace Backdrop.Interop;

/// <summary>
/// A global, low-level keyboard hook that fires once each time a modifier chord is pressed.
/// The backdrop never holds focus, so RegisterHotKey and normal key events never reach it;
/// this hook sees the keyboard system-wide instead.
///
/// The chord is Ctrl+Alt+B by default. Each press toggles the on-scene console: the host
/// opens it and pins the scene interactive, or closes it and hands input back to the desktop.
/// </summary>
internal sealed class Hotkey : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12; // Alt
    private const int VK_TRIGGER = 0x42; // 'B'

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
    private IntPtr _hook;

    // Auto-repeat sends a stream of WM_KEYDOWNs while the key is held; only the first,
    // where the trigger was not already down, should count as a press.
    private bool _triggerDown;

    /// <param name="onPressed">
    /// Raised once per chord press. The hook runs on a system thread, so the handler must
    /// marshal to the UI thread itself.
    /// </param>
    internal Hotkey(Action onPressed)
    {
        _onPressed = onPressed;
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

            if (data.vkCode == VK_TRIGGER)
            {
                bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
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
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    private static bool Held(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    public void Dispose()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }
}
