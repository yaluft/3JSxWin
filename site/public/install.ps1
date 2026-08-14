# 3JSxWin installer.
#   irm https://yakupov.xyz/install.ps1 | iex
#   irm https://yakupov.xyz/install.ps1 -OutFile $env:TEMP\3jsxwin-install.ps1
#   & $env:TEMP\3jsxwin-install.ps1 -Uninstall

$ErrorActionPreference = "Stop"
$DownloadUrl = "https://yakupov.xyz/download/3jsxwin-win-x64.zip"
$InstallDir = Join-Path $env:LOCALAPPDATA "3JSxWin"
$StartupArgs = ""
$NoStart = $false
$Uninstall = $false

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "-Uninstall" { $Uninstall = $true }
        "-NoStart" { $NoStart = $true }
        "-StartupArgs" { $i++; $StartupArgs = [string]$args[$i] }
        "-InstallDir" { $i++; $InstallDir = [string]$args[$i] }
    }
}

function Get-StartupLink {
    Join-Path ([Environment]::GetFolderPath("Startup")) "Backdrop.lnk"
}

function Remove-StartupLink {
    $link = Get-StartupLink
    if (Test-Path $link) { Remove-Item $link -Force }
}

function Test-DesktopRuntime {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { return $false }
    $runtimes = & dotnet --list-runtimes 2>$null
    return [bool]($runtimes -match "Microsoft\.WindowsDesktop\.App 8\.")
}

function Install-DesktopRuntime {
    if (Test-DesktopRuntime) {
        Write-Host "Found .NET 8 Desktop Runtime." -ForegroundColor DarkGray
        return
    }
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing .NET 8 Desktop Runtime with winget..." -ForegroundColor Cyan
        & winget install --id Microsoft.DotNet.DesktopRuntime.8 --accept-package-agreements --accept-source-agreements
        return
    }
    Write-Host "The .NET 8 Desktop Runtime is not installed, and winget is not on PATH." -ForegroundColor Yellow
    Write-Host "Install it from https://dotnet.microsoft.com/download/dotnet/8.0 (Desktop Runtime, x64),"
    Write-Host "then run Backdrop.exe again."
}

if ($Uninstall) {
    Get-Process Backdrop -ErrorAction SilentlyContinue | Stop-Process -Force
    Remove-StartupLink
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Write-Host "3JSxWin removed from $InstallDir" -ForegroundColor Green
    return
}

Write-Host "Installing 3JSxWin -> $InstallDir" -ForegroundColor Cyan

$temp = Join-Path $env:TEMP "3jsxwin-setup"
$zip = Join-Path $temp "3jsxwin-win-x64.zip"
New-Item -ItemType Directory -Force -Path $temp | Out-Null

Write-Host "Downloading $DownloadUrl"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $zip -UseBasicParsing

if (Test-Path $InstallDir) {
    Get-Process Backdrop -ErrorAction SilentlyContinue | Stop-Process -Force
    Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
Remove-Item $temp -Recurse -Force

$exe = Join-Path $InstallDir "Backdrop.exe"
if (-not (Test-Path $exe)) { throw "Backdrop.exe missing from the zip." }

Install-DesktopRuntime

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Get-StartupLink))
$shortcut.TargetPath = $exe
$shortcut.Arguments = $StartupArgs
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = "three.js backdrop for the Windows desktop"
$shortcut.Save()

Write-Host "Installed. Startup shortcut created." -ForegroundColor Green
Write-Host "  $exe"
Write-Host "  $(Get-StartupLink)"

if (-not $NoStart) {
    Start-Process -FilePath $exe -ArgumentList "--window" -WorkingDirectory $InstallDir
    Write-Host "Opened a preview window. Close it, then run Backdrop.exe (no flags) to put it on the desktop."
}
