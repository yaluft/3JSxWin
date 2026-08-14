<#
.SYNOPSIS
  Starts Backdrop when you sign in, by dropping a shortcut in your Startup folder.
  No registry keys, no scheduled task, no admin rights. Remove it with -Remove.

.EXAMPLE
  .\install-startup.ps1
  .\install-startup.ps1 -Arguments "--span-all"
  .\install-startup.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$ExePath = "$PSScriptRoot\dist\Backdrop.exe",
    [string]$Arguments = "",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$link = Join-Path $startup "Backdrop.lnk"

if ($Remove) {
    if (Test-Path $link) {
        Remove-Item $link
        Write-Host "Backdrop will no longer start with Windows." -ForegroundColor Green
    } else {
        Write-Host "Nothing to remove."
    }
    return
}

if (-not (Test-Path $ExePath)) {
    throw "Backdrop.exe not found at $ExePath. Run .\build.ps1 first, or pass -ExePath."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = (Resolve-Path $ExePath).Path
$shortcut.Arguments = $Arguments
$shortcut.WorkingDirectory = Split-Path (Resolve-Path $ExePath).Path
$shortcut.Description = "three.js backdrop for the Windows desktop"
$shortcut.Save()

Write-Host "Backdrop will start with Windows." -ForegroundColor Green
Write-Host "Shortcut: $link"
