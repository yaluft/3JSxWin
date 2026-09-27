// Hotkey.cs — the app's global keyboard shortcuts.
// Backdrop lives behind the desktop and never takes focus, so it installs a
// system-wide low-level keyboard hook (WH_KEYBOARD_LL) to see chords like
// Ctrl+Alt+B and Win+] no matter which window is active. It can also swallow
// a chord (return 1) so the shell — e.g. Copilot on Win+C — never sees it.
//
// Copilot ownership: while Backdrop runs, BOTH Copilot entry points are taken —
// the Win+C shortcut and the dedicated Copilot keyboard key, which the PC-AT
// compatible stack delivers as a chord around F23 (observed as Win+F23, often
// with Ctrl/Shift along: Ctrl+Shift+Win+F23). Both are eaten on the down AND up
// edge so the shell never assembles a complete chord, and both open Comms.

using System.Runtime.InteropServices;

namespace Backdrop.Interop;

/// <summary>
/// A global, low-level keyboard hook that fires once each time a modifier chord is pressed.
/// The backdrop never holds focus, so RegisterHotKey and normal key events never reach it;
/// this hook sees the keyboard system-wide instead.
///
/// The chord is Ctrl+Alt+B by default. Each press toggles the on-scene console: the host
/// opens it and pins the scene interactive, or closes it and hands input back to the desktop.
/// Win+C — and the hardware Copilot key (a Win+F23 chord) — toggles Comms; both are
/// swallowed so Copilot never opens. Win+Shift+U force-opens DevTools (the secret dev
/// chord — it works even without --devtools). Win+Shift+- triggers a dev-loop
/// rebuild-and-relaunch instead.
///
/// Why a hook and not RegisterHotKey: RegisterHotKey needs a window to deliver
/// WM_HOTKEY to and cannot suppress the keystroke, so the shell would still act
/// on Win+C. A WH_KEYBOARD_LL hook runs before the shell and can eat the chord.
/// The trade-off: the callback runs on a system thread and must return fast, so
/// each handler here just raises an Action and lets the app marshal to the UI thread.
/// </summary>
internal sealed class Hotkey : IDisposable
{
    // WH_KEYBOARD_LL = the "low-level keyboard" hook id passed to SetWindowsHookEx.
    private const int WH_KEYBOARD_LL = 13;

    // The four key messages the hook can carry. SYS* variants arrive when Alt (or
    // F10) is part of the chord — Windows routes Alt+key as a "system" keystroke,
    // so we have to treat WM_SYSKEYDOWN the same as WM_KEYDOWN or Ctrl+Alt+B misses.
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;

    // Virtual-key codes. The KBDLLHOOKSTRUCT only tells us which key moved; to know
    // the modifiers we poll their state separately (GetAsyncKeyState below).
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12; // Alt
    private const int VK_SHIFT = 0x10;
    private const int VK_LWIN = 0x5B; // left Windows key
    private const int VK_RWIN = 0x5C; // right Windows key
    private const int VK_TRIGGER = 0x42; // 'B' — the Ctrl+Alt+B console toggle
    private const int VK_C = 0x43;
    private const int VK_U = 0x55;     // 'U' — Win+Shift+U = secret DevTools toggle
    private const int VK_F23 = 0x86;   // F23 — the payload key of the Copilot button
    private const int VK_OEM_4 = 0xDB; // '[' — Win+[ = previous scene
    private const int VK_OEM_6 = 0xDD; // ']' — Win+] = next scene
    private const int VK_P = 0x50;     // 'P' — Win+P = shuffle (yes, shadows the shell's projection menu)
    private const int VK_OEM_MINUS = 0xBD; // '-' — Win+Shift+- = dev rebuild

    // The payload Windows hands the hook for each keystroke. Layout must match the
    // Win32 struct exactly (Sequential, no reordering) or Marshal reads garbage.
    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;        // which virtual key
        public uint scanCode;      // hardware scan code (unused here)
        public uint flags;         // injected / extended / transition bits (unused here)
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // Managed signature of the callback Windows invokes for every keystroke.
    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    // SetWindowsHookEx(WH_KEYBOARD_LL, ...) installs a system-wide keyboard hook.
    // Returns a handle we must keep to remove it later. SetLastError so a failure
    // is diagnosable.
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    // Removes the hook. Called from Dispose so we don't leak a system-wide hook
    // (which would keep invoking a dead delegate and slow every keystroke on the box).
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    // Passes the keystroke down the hook chain. Call this for anything we don't
    // want to swallow, or other apps' hooks (and the shell) stop getting keys.
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    // Reads the live up/down state of a key. Bit 0x8000 = currently held. We use
    // this to check modifiers because the hook struct only reports the one key
    // that changed, not the whole chord.
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    // A module handle for the current process — WH_KEYBOARD_LL wants one even
    // though the hook is global and runs in-process. GetModuleHandle(null) = us.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    // Kept alive as a field so the delegate is not collected while the hook holds it.
    // Win32 has a raw function pointer to this; if the GC moves/collects the
    // delegate the next keystroke calls into freed memory and the process dies.
    private readonly HookProc _proc;

    // The app supplies one callback per shortcut. Each runs on a system thread,
    // so every handler must marshal to the UI thread before touching WPF.
    private readonly Action _onPressed;       // Ctrl+Alt+B — toggle console
    private readonly Action<string> _onScene; // Win+[ / Win+] / Win+P — "prev" / "next" / "shuffle"
    private readonly Action _onRebuild;       // Win+Shift+- — dev rebuild+relaunch
    private readonly Action _onComms;         // Win+C / Copilot key / Ctrl+Alt+C — toggle Comms
    private readonly Action _onDevTools;      // Win+Shift+U — force-open DevTools
    private IntPtr _hook;

    // De-bounce state. Holding a key makes Windows fire a stream of repeated
    // WM_KEYDOWNs; we only want the first edge. Each flag says "this key is
    // already down, ignore repeats until it comes back up".
    private bool _triggerDown;   // Ctrl+Alt+B
    private bool _commsAltDown;  // Ctrl+Alt+C
    private uint _winChord;      // the single Win+<key> currently latched (0 = none)

    /// <param name="onPressed">
    /// Raised once per Ctrl+Alt+B. The hook runs on a system thread, so the handler must
    /// marshal to the UI thread itself.
    /// </param>
    /// <param name="onScene">Win+[ prev, Win+] next, Win+P shuffle.</param>
    /// <param name="onRebuild">Win+Shift+-. Also fires on a system thread.</param>
    /// <param name="onComms">Win+C and the hardware Copilot key (Win+F23). The hook eats both chords so Copilot does not open.</param>
    /// <param name="onDevTools">Win+Shift+U — the secret dev chord. Also on a system thread.</param>
    internal Hotkey(Action onPressed, Action<string>? onScene = null, Action? onRebuild = null, Action? onComms = null, Action? onDevTools = null)
    {
        _onPressed = onPressed;
        // Missing callbacks become no-ops so HookCallback never has to null-check.
        _onScene = onScene ?? (_ => { });
        _onRebuild = onRebuild ?? (() => { });
        _onComms = onComms ?? (() => { });
        _onDevTools = onDevTools ?? (() => { });
        // Cache the delegate once (see _proc field) — a fresh `HookCallback` each
        // call would hand Win32 a pointer to a collectable object.
        _proc = HookCallback;
    }

    // Installs the hook. Idempotent: a second call while we already hold one is a no-op.
    // dwThreadId 0 = hook every thread on the desktop, i.e. truly global.
    internal void Start()
    {
        if (_hook != IntPtr.Zero) return;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
    }

    // The hook body. Windows calls this on a system thread for every key event on
    // the desktop, so it must be quick and must not throw. Returning 1 swallows the
    // key; anything else (via CallNextHookEx) passes it through to the shell/apps.
    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        // nCode < 0 means "not ours to inspect" — Win32 rule: pass it straight on.
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);

            // Alt-chords come through as WM_SYSKEYDOWN/UP, so fold both forms together.
            bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
            bool up = msg is WM_KEYUP or WM_SYSKEYUP;

            // Win+C and the hardware Copilot key — take them from Copilot. On Win11 the
            // shell opens Copilot on Win+C, and the dedicated Copilot key on newer
            // keyboards arrives as an F23 chord (Win+F23, usually with Ctrl+Shift along
            // — vendors vary, so for F23 we tolerate the extra modifiers). We want BOTH
            // for Comms instead. Returning 1 for the down AND the up edge means the
            // shell never assembles a complete chord, so Copilot stays shut. The
            // bare-Win check on 'C' (no Ctrl/Alt/Shift) keeps Win+Ctrl+C etc. free for
            // other software; F23 is effectively unused by anything else, so it is
            // claimed whenever Win is held.
            bool copilotKey = data.vkCode == VK_F23 && WinHeld();
            if ((data.vkCode == VK_C && WinHeld() && !Held(VK_CONTROL) && !Held(VK_MENU) && !Held(VK_SHIFT)) || copilotKey)
            {
                if (down && _winChord != data.vkCode)
                {
                    _winChord = data.vkCode;
                    _onComms();
                }
                if (up && _winChord == data.vkCode) _winChord = 0;
                return (IntPtr)1; // eat it
            }

            // Ctrl+Alt+C — a fallback for the same Comms toggle, for people whose
            // Win+C is already claimed (remapped, or a policy-managed machine).
            // Note we do NOT swallow this one; Ctrl+Alt+C isn't a shell chord.
            if (data.vkCode == VK_C && !WinHeld() && Held(VK_CONTROL) && Held(VK_MENU) && !Held(VK_SHIFT))
            {
                if (down && !_commsAltDown)
                {
                    _commsAltDown = true;
                    _onComms();
                }
                else if (!down)
                {
                    _commsAltDown = false;
                }
            }

            // Ctrl+Alt+B — the main console toggle. We watch the 'B' key edge and
            // only check the modifiers when B goes down, so releasing Ctrl/Alt
            // first doesn't matter. Not swallowed: Ctrl+Alt+B is free in the shell.
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

            // Win+Shift+U — the secret developer chord: force-open DevTools on the
            // scene. "Secret" because nothing in the UI advertises it and it works
            // even when the app was not launched with --devtools (SceneHost flips the
            // WebView2 setting on at runtime). Swallowed so the shell never sees it,
            // same one-fire-per-press latch as the other Win chords.
            if (down && WinHeld() && data.vkCode == VK_U && Held(VK_SHIFT) && !Held(VK_CONTROL) && !Held(VK_MENU) && _winChord != data.vkCode)
            {
                _winChord = data.vkCode;
                _onDevTools();
                return (IntPtr)1;
            }

            // Win+Shift+- — developer loop: rebuild the solution and relaunch.
            // Swallowed so it doesn't also trigger the shell's zoom-out. The
            // `_winChord != vkCode` guard is the auto-repeat de-bounce (one fire
            // per physical press); the matching reset is at the bottom.
            if (down && WinHeld() && data.vkCode == VK_OEM_MINUS && Held(VK_SHIFT) && _winChord != data.vkCode)
            {
                _winChord = data.vkCode;
                _onRebuild();
                return (IntPtr)1;
            }

            // Win+[  Win+]  Win+P — cycle scenes: previous / next / shuffle.
            // Swallowed so Win+P doesn't drop the projection ("Project") flyout
            // over the wallpaper. Same one-fire-per-press latch via _winChord.
            if (down && WinHeld() && data.vkCode is VK_OEM_4 or VK_OEM_6 or VK_P && _winChord != data.vkCode)
            {
                _winChord = data.vkCode;
                _onScene(data.vkCode == VK_OEM_4 ? "prev" : data.vkCode == VK_OEM_6 ? "next" : "shuffle");
                return (IntPtr)1;
            }

            // Key released: clear the latch so the next press of that Win+<key> counts.
            if (!down && data.vkCode == _winChord) _winChord = 0;
        }
        // Not one of ours (or a chord we chose not to eat): let it flow on.
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    // A key is "held" when GetAsyncKeyState's high bit (0x8000) is set.
    private static bool Held(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    // Either Windows key counts — users press whichever is nearer.
    private static bool WinHeld() => Held(VK_LWIN) || Held(VK_RWIN);

    // Remove the system-wide hook on shutdown. Leaving it installed would make
    // every keystroke on the machine call into a torn-down object.
    public void Dispose()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }
}
