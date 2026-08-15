<#
.SYNOPSIS
  Starts dist\Backdrop.exe without attaching the console (avoids Chromium stderr).
#>
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "dist\Backdrop.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Backdrop.exe not found. Run .\build.ps1 first." -ForegroundColor Red
    exit 1
}
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
Write-Host "Backdrop started."
