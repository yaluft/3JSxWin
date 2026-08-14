<#
.SYNOPSIS
  Builds Backdrop into .\dist.

.EXAMPLE
  .\build.ps1
  Framework-dependent build. Needs the .NET 8 Desktop Runtime on the target machine.

.EXAMPLE
  .\build.ps1 -SelfContained
  Bundles the runtime. Larger folder, but it runs on a clean Windows 11 box.
#>
[CmdletBinding()]
param(
    [switch]$SelfContained,
    [string]$Output = "dist"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Host "dotnet was not found on PATH." -ForegroundColor Red
    Write-Host "Install the .NET 8 SDK (x64) from https://dotnet.microsoft.com/download/dotnet/8.0,"
    Write-Host "then close and reopen this terminal so it picks up the new PATH."
    exit 1
}

# Note: do not call this `$args`. That name is a PowerShell automatic variable and is
# not available inside a [CmdletBinding()] script, so splatting it silently misbehaves.
$publishArgs = @(
    "publish", "src\Backdrop\Backdrop.csproj",
    "-c", "Release",
    "-r", "win-x64",
    "-o", $Output,
    "--self-contained", $(if ($SelfContained) { "true" } else { "false" })
)

if ($SelfContained) {
    $publishArgs += @("-p:PublishSingleFile=false", "-p:PublishTrimmed=false")
}

Write-Host "Building Backdrop -> $Output" -ForegroundColor Cyan
Write-Host "dotnet $($publishArgs -join ' ')" -ForegroundColor DarkGray
Write-Host ""

& dotnet @publishArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed (exit $LASTEXITCODE). The lines above are the real error." -ForegroundColor Red
    Write-Host "Common causes: no .NET 8 SDK (run 'dotnet --list-sdks'), or nuget.org unreachable."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done. Run it with:" -ForegroundColor Green
Write-Host "  .\$Output\Backdrop.exe --window     (test in a normal window first)"
Write-Host "  .\$Output\Backdrop.exe              (put it on the desktop)"
