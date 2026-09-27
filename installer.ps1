<#
.SYNOPSIS
  Installs Backdrop into the deepest standard per-user location and wires up Windows.

.DESCRIPTION
  Target: %LOCALAPPDATA%\Programs\Win11Backdrop — the deepest install path that
  works best for a per-user app: inside the user profile (no admin, no UAC, no
  machine-wide state), on the user's own volume, and fully deletable by its
  owner. This is where per-user apps like Windows Terminal live.

  What it does:
    1. (-Build) Publishes from source via a staging folder + robocopy /PURGE
       into the target, so leftover hostfxr.dll from a previous self-contained
       install cannot hijack the apphost ("You must install .NET").
       (Without -Build it copies .\dist verbatim; run .\build.ps1 first.)
    2. Pins a Start-menu shortcut.
    3. Creates the Startup shortcut (skip with -NoStartup).
    4. Registers a per-user Add/Remove-Programs entry (uninstall via uninstall.ps1).
    5. Launches the app (skip with -NoRun).

  The app itself registers the rest on first launch (3jsxwin: protocol, desktop
  context menu, companion .theme, screensaver path) — self-healing per launch.

.EXAMPLE
  .\installer.ps1 -Build -Force
  Rebuild from source, stop a running copy, install, and relaunch from the new location.

.EXAMPLE
  .\installer.ps1
  Install the already-built .\dist as-is.

.EXAMPLE
  .\installer.ps1 -NoStartup -NoRun
  Install without autostart or launching (portable-ish install).
#>
[CmdletBinding()]
param(
    [switch]$Build,       # publish from source into the target folder
    [switch]$SelfContained, # (with -Build) bundle the .NET runtime; larger, runs anywhere
    [switch]$NoStartup,   # don't create the logon Startup shortcut
    [switch]$NoRun,       # don't launch after installing
    [switch]$Force,       # stop a running Backdrop so files can update / new copy can start
    [string]$Destination  # override the install folder (default: the deep per-user path)
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# The deepest standard per-user install path: inside the profile, no admin ever needed.
$Target = if ($Destination) { $Destination } else { Join-Path $env:LOCALAPPDATA 'Programs\Win11Backdrop' }
$Exe = Join-Path $Target 'Backdrop.exe'

# --- preflight ---------------------------------------------------------------

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue) -and $Build) {
    Write-Host "dotnet was not found on PATH - cannot -Build." -ForegroundColor Red
    exit 1
}
if (-not $Build -and -not (Test-Path '.\dist\Backdrop.exe')) {
    Write-Host ".\dist\Backdrop.exe not found. Run .\build.ps1 first, or use -Build." -ForegroundColor Red
    exit 1
}

# A running instance locks the exe we may need to replace (and its single-instance
# mutex blocks the new copy from starting). -Force stops it; otherwise we abort only
# when the running copy is actually the one being updated.
$running = @(Get-Process -Name Backdrop -ErrorAction SilentlyContinue | Where-Object { $_.Path })
if ($running.Count -gt 0) {
    $fromTarget = @($running | Where-Object { $_.Path -like "$Target*" })
    if ($Force) {
        Write-Host "Stopping running Backdrop ($($running.Count) process(es))..." -ForegroundColor Yellow
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 800
    }
    elseif ($fromTarget.Count -gt 0) {
        Write-Host "Backdrop is running from the install folder; files are locked." -ForegroundColor Red
        Write-Host "Re-run with -Force to stop it and update in place." -ForegroundColor Yellow
        exit 1
    }
}

# --- lay down the files ------------------------------------------------------

function Copy-TreePurge([string]$From, [string]$To) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    # robocopy exit codes 0-7 are success (1 = files copied); >= 8 is a real error.
    robocopy $From $To /E /PURGE /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Host "robocopy failed (exit $LASTEXITCODE)." -ForegroundColor Red; exit 1 }
    $global:LASTEXITCODE = 0
}

if ($Build) {
    Write-Host "Publishing source -> $Target" -ForegroundColor Cyan
    $stage = Join-Path ([System.IO.Path]::GetTempPath()) ('Win11Backdrop-publish-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    try {
        $pub = @('publish', 'src\Backdrop\Backdrop.csproj', '-c', 'Release', '-r', 'win-x64',
                 '-o', $stage, '--self-contained', $(if ($SelfContained) { 'true' } else { 'false' }))
        & dotnet @pub
        if ($LASTEXITCODE -ne 0) { Write-Host "Publish failed." -ForegroundColor Red; exit $LASTEXITCODE }
        Copy-TreePurge $stage $Target
    }
    finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
else {
    Write-Host "Copying .\dist -> $Target" -ForegroundColor Cyan
    Copy-TreePurge '.\dist' $Target
}

if (-not (Test-Path $Exe)) { Write-Host "Install incomplete - no Backdrop.exe at $Exe" -ForegroundColor Red; exit 1 }

# --- shortcuts ---------------------------------------------------------------

$wshType = [type]::GetTypeFromProgID('WScript.Shell')
$shell = [Activator]::CreateInstance($wshType)

function New-Shortcut([string]$Link, [string]$TargetExe, [string]$Description) {
    $lnk = $shell.CreateShortcut($Link)
    $lnk.TargetPath = $TargetExe
    $lnk.WorkingDirectory = Split-Path $TargetExe   # web/config.json resolve relative to the exe folder
    $lnk.Description = $Description
    $lnk.Save()
}

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Win11Backdrop.lnk'
New-Shortcut $startMenu $Exe 'three.js backdrop for the Windows desktop'
Write-Host "Start menu: $startMenu" -ForegroundColor DarkGray

if (-not $NoStartup) {
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Backdrop.lnk'
    New-Shortcut $startup $Exe 'three.js backdrop for the Windows desktop'
    Write-Host "Startup:    $startup" -ForegroundColor DarkGray
}

# --- uninstaller + Add/Remove Programs entry ---------------------------------

$uninstallPs1 = Join-Path $Target 'uninstall.ps1'
@'
# uninstall.ps1 - generated by installer.ps1. Removes shortcuts, the ARP entry,
# the shell hooks the app registered, and this install folder. Per-user only.
$ErrorActionPreference = 'Stop'
$target = $PSScriptRoot

Get-Process -Name Backdrop -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$target*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500

Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Win11Backdrop.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'Backdrop.lnk') -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Classes\DesktopBackground\Shell\3JSxWin' -Recurse -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Classes\3jsxwin' -Recurse -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Win11Backdrop' -Recurse -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Themes\3JSxWin.theme') -ErrorAction SilentlyContinue

# Only unhook the screensaver if it currently points at THIS install.
$desk = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Control Panel\Desktop', $true)
if ($desk) {
    $scr = $desk.GetValue('SCRNSAVE.EXE')
    if ($scr -and $scr.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) {
        $desk.DeleteValue('SCRNSAVE.EXE', $false)
        $desk.SetValue('ScreenSaveActive', '0')
    }
    $desk.Close()
}

# Logs / WebView2 profile (config.json lives in the install folder, already going away).
Remove-Item (Join-Path $env:LOCALAPPDATA 'Backdrop') -Recurse -ErrorAction SilentlyContinue

# Delete our own folder last; if the script file is still held open, retry via cmd.
try {
    Remove-Item $target -Recurse -Force -ErrorAction Stop
} catch {
    Start-Process cmd -WindowStyle Hidden -Args '/c', "timeout /t 2 >nul & rmdir /s /q `"$target`""
}
Write-Host 'Win11Backdrop removed.'
'@ | Set-Content -Path $uninstallPs1 -Encoding UTF8

# ProductVersion carries a "+<git-hash>" informational suffix from the SDK;
# Add/Remove Programs looks cleaner with just the semver.
$version = (Get-Item $Exe).VersionInfo.ProductVersion -split '\+' | Select-Object -First 1
$arp = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Win11Backdrop'
New-Item -Path $arp -Force | Out-Null
Set-ItemProperty $arp -Name DisplayName     -Value 'Win11Backdrop (3JSxWin)'
Set-ItemProperty $arp -Name DisplayVersion  -Value $version
Set-ItemProperty $arp -Name Publisher       -Value '3JSxWin'
Set-ItemProperty $arp -Name InstallLocation -Value $Target
Set-ItemProperty $arp -Name DisplayIcon     -Value "$Exe,0"
Set-ItemProperty $arp -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallPs1`""
Set-ItemProperty $arp -Name NoModify        -Value 1 -Type DWord
Set-ItemProperty $arp -Name NoRepair        -Value 1 -Type DWord
Write-Host "Uninstall entry registered (v$version)." -ForegroundColor DarkGray

# --- launch ------------------------------------------------------------------

$stillRunning = @(Get-Process -Name Backdrop -ErrorAction SilentlyContinue | Where-Object { $_.Path })
if ($NoRun) {
    Write-Host "Installed. Launch later from: $Exe" -ForegroundColor Green
}
elseif ($stillRunning.Count -gt 0) {
    # A copy is still running from somewhere else (e.g. .\dist) and owns the
    # single-instance mutex; the new install can't start beside it.
    Write-Host "Installed, but a Backdrop from another folder is still running." -ForegroundColor Yellow
    Write-Host "Quit it from its tray icon, then start: $Exe  (or re-run with -Force)." -ForegroundColor Yellow
}
else {
    Start-Process -FilePath $Exe -WorkingDirectory $Target
    Write-Host "Installed and running from $Target" -ForegroundColor Green
}
