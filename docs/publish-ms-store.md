# Publish to the Microsoft Store

This repo ships an **unpackaged** `WinExe` (`Backdrop.exe` + `web\`). The Store does not take that folder as-is. You wrap it as **MSIX** (or list a signed Win32 installer). This page is the path for *this* app, not a generic Store tutorial.

Nothing below is implemented in the tree yet. Do not file a submission until the packaging project exists and `--window` still works from the MSIX.

## What this app is, to the Store

| Fact | Implication |
| --- | --- |
| WPF + WinForms tray + WebView2 | Package as a **full-trust** desktop (Win32) app, not AppContainer / UWP |
| Attaches to Explorer `WorkerW` | Restricted sandbox will break desktop mode. Full trust is required |
| Low-level hotkeys (`Win+]`, `Ctrl+Alt+B`) | Declare input / unrestricted capabilities; certification will ask why |
| Writes `config.json` next to the scene | After packaging, write to `%LOCALAPPDATA%\Backdrop\` only — the install folder is read-only |
| `install-startup.ps1` | Store apps use a **StartupTask** in the manifest, not a user Startup `.lnk` |
| x64 only (`PlatformTarget`) | Store listing is **Windows 10/11 x64**. No ARM64 until you add a RID |
| WebView2 Evergreen | Declare the WebView2 runtime as a dependency (or assume Win11) |
| No admin in `app.manifest` | Good. Store rejects `requireAdministrator` |

Related gaps: [known-limitations.md](known-limitations.md).

## Two submission shapes

### A. MSIX (recommended)

Windows Application Packaging Project (`wapproj`) wrapping `src/Backdrop`. Identity, capabilities, and updates all go through Partner Center. Users get Store updates. This is the path to implement.

### B. Win32 EXE listing

Partner Center can list a classic installer. More review friction, you own the updater, and Explorer-hook wallpapers get extra questions. Use only if MSIX blocks WorkerW in certification.

Do **not** submit the current `dist\` zip through either path.

## 0. Accounts and identity

1. [Microsoft Partner Center](https://partner.microsoft.com/dashboard) — individual (~$19 one-time) or company (~$99). Company if you want a publisher name that is not your MSA.
2. Reserve the Store name (e.g. **3JSxWin** or **Backdrop**). The reserved name is locked to your publisher.
3. Copy from the product’s **Identity**:
   - Publisher (CN=…)
   - Package Family Name
   - Package/Identity name
4. Those three strings go in the packaging manifest. Changing them later is a new Store product.

Use a **code-signing** cert for sideload tests. Store submission is re-signed by Microsoft.

## 1. Add packaging (not in the repo today)

In Visual Studio (or `dotnet` + a `wapproj`):

1. Add a **Windows Application Packaging Project** to `Win11Backdrop.sln`.
2. Application → `Backdrop` (`net8.0-windows`, `win-x64`).
3. `Package.appxmanifest`:
   - Identity Name / Publisher / Version from Partner Center
   - Display name, publisher display name, logo 44/150/50
   - **Target device family:** Windows.Desktop, min `10.0.19041.0` (Win10 20H1, same as we already claim)
   - **Capabilities (full trust desktop):**
     - `runFullTrust`
     - internetClient (WebView2, optional theme fetch is local-only today)
   - **Extensions:**
     - `windows.startupTask` (replaces `install-startup.ps1`)
     - *do not* request `allowElevation`
4. Visual assets: Store logos 400×400, 300×300, 150×150, 44×44; splash optional. Source: `src/Backdrop/app.ico` / `docs/app-icon.jpg`.
5. Build **Release | x64**. Output is `.msix` or `.msixbundle`.

Self-contained publish (`.\build.ps1 -SelfContained`) is safer for Store machines that lack the .NET 8 Desktop Runtime. Framework-dependent is smaller but the Store must then declare the .NET runtime as a prerequisite.

## 2. Code changes the package will force

These are blockers if you only wrap today’s `dist\`:

| Today | After MSIX |
| --- | --- |
| `dist\web\config.json` writable | Install dir is immutable. Persist config, layout, and logs under `%LOCALAPPDATA%\Backdrop\` |
| `Open scene folder` opens the install `web\` | Open the **writable** config folder, or a copy |
| `install-startup.ps1` | Enable the manifest StartupTask; first-run prompt |
| Single-instance mutex | Keep it; use a name under your PFN so two Store + sideload copies do not collide |
| Tray **Quit / Kill** | Fine. Do not call `Environment.Exit` in a way that skips MSIX shutdown |
| WebView2 user data | Point `UserDataFolder` at LocalAppData, never Program Files |
| `--diagnose` / DevTools | Hide or gate DevTools in Store builds (`#if STORE` or a compile constant) |

Desktop attach (`DesktopLayer` / WorkerW) must still work **packaged**. Test that in the MSIX **before** submission. If `SetParent` to WorkerW fails when packaged, you cannot ship desktop mode through the Store.

## 3. Local proof (mandatory)

```powershell
# After the packaging project exists:
# 1. Build the MSIX (Release x64)
# 2. Enable Developer Mode or sideload
Add-AppxPackage -Path .\pkg\Backdrop_x64.msix

# 3. Windowed first — same rule as CONTRIBUTING.md
# Start Menu → 3JSxWin → should be windowed or honour last mode

# 4. Then desktop attach
# Tray → put on the desktop. Confirm icons click, taskbar on top.
# Log: %LOCALAPPDATA%\Backdrop\backdrop.log → Attached to WorkerW

# 5. Uninstall
Get-AppxPackage *Backdrop* | Remove-AppxPackage
```

Certification kit: install [Windows App Certification Kit](https://learn.microsoft.com/windows/uwp/debug-test-perf/windows-app-certification-kit) and run it on the MSIX. Fix every **Failed** before upload. Expected pain points: binary analyzer (WebView2), file-write to install dir, unsupported APIs if you P/Invoke something WACK flags.

## 4. Partner Center listing

Create the product, then fill:

| Field | What to put |
| --- | --- |
| Product name | Reserved name |
| Properties | Desktop, Win10/11, x64 |
| Age rating | IARC questionnaire. Wallpaper + generated audio, no UGC, no ads → typically 3+ / Everyone if you do not mention adult content |
| Privacy policy | **Required** public HTTPS URL (a page on [yakupov.xyz](https://yakupov.xyz/) is enough). State: no account, config stays on device, WebView2 is local files |
| Category | Personalization → Themes / Wallpaper |
| Pricing | Free, or paid; Store cut applies |
| Store listings (en-US first) | Short description, long description, 1–3 search terms |
| Screenshots | Min 1, prefer 1920×1080 or 1366×768. Capture `--window` plus a desktop shot with icons visible so reviewers see WorkerW |
| Store logo | 300×300 PNG |
| Support | GitHub issues or an email you read |
| Notes to testers | How to open the tray, that desktop mode hides the window, `--window` if attach fails, WebView2 required |

Long description should say it is a **live three.js wallpaper** that sits *behind* icons. Reviewers who only launch the window will think it is a screen saver.

## 5. Upload and certification

1. Packages → upload the `.msix` / `.msixbundle`.
2. Microsoft re-signs it. Version must **increase** every submission (`1.0.1.0`, then `1.0.2.0`).
3. Certification is automated WACK + a human pass. Typical wait: hours to a few days.
4. If they reject WorkerW / hooks, read the report. Common asks: justify the keyboard hook, prove you do not inject into other processes, prove uninstall restores the desktop.
5. After publish, Store updates replace the package. Users keep `%LOCALAPPDATA%\Backdrop\` data.

Flight a **package flight** (private / friends) before 100% rollout.

## 6. Store policy landmines (this app)

- **Desktop modification.** Attaching to Explorer is unusual. Notes to testers + a video of icons staying clickable help.
- **Global hooks.** `Win+]` / `Ctrl+Alt+B` must be documented. `Win+P` already fights OS Project — do not claim exclusive use.
- **No deception.** The listing must not look like a Microsoft / Wallpaper Engine product.
- **No admin, no kernel drivers.** We already match that.
- **Content.** Theme shaders are abstract. Do not ship assets that violate Store content rules.
- **Privacy.** If you later add telemetry or a theme marketplace, update the privacy page *before* that build.

## 7. What we will not do for Store

- AppContainer / partial trust
- ARM64 until someone ports and tests WorkerW there
- Shipping DevTools and `--diagnose` as primary Store UX
- Relying on `.\install-startup.ps1` or writing into the package `web\` folder

## 8. Checklist before first upload

- [ ] Partner Center account + reserved name + privacy URL live
- [ ] `wapproj` (or equivalent) in the sln, identity matches Partner Center
- [ ] Config / logs / WebView2 user data only under LocalAppData
- [ ] StartupTask works; old Startup `.lnk` not required
- [ ] Sideloaded MSIX: `--window` works
- [ ] Sideloaded MSIX: desktop attach works (`Attached to WorkerW`)
- [ ] WACK clean
- [ ] Screenshots + store logo + tester notes
- [ ] Version bumped
- [ ] Flight, then public

When the packaging project lands, add the project path and the exact `msbuild` / `dotnet` command to this page and delete the “not in the repo” sentence at the top.
