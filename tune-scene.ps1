<#
  tune-scene.ps1 - applies the bigger/faster/denser aurora settings.
  Backs up every file it touches as *.bak. Run with -Revert to undo.

  .\tune-scene.ps1
  .\tune-scene.ps1 -Root "C:\Program Files\Win11Backdrop"
  .\tune-scene.ps1 -Revert
#>
[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramFiles\Win11BackDrop",
    [switch]$Revert
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Root)) { Write-Host "Not found: $Root" -ForegroundColor Red; exit 1 }

# Patch every copy of the scene: the built one and the source one, so a rebuild
# does not quietly undo this.
$webDirs = @("$Root\dist\web", "$Root\src\Backdrop\web", "$Root\web") |
           Where-Object { Test-Path $_ }

if (-not $webDirs) { Write-Host "No web\ folder under $Root" -ForegroundColor Red; exit 1 }

# --- revert -------------------------------------------------------------------
if ($Revert) {
    Get-ChildItem $webDirs -Recurse -Filter *.bak | ForEach-Object {
        $target = $_.FullName -replace '\.bak$',''
        Move-Item $_.FullName $target -Force
        Write-Host "restored $target" -ForegroundColor Yellow
    }
    Write-Host "`nReload scene from the tray icon." -ForegroundColor Green
    exit 0
}

# --- guard against writing where we cannot ------------------------------------
try { [IO.File]::OpenWrite("$($webDirs[0])\config.json").Close() }
catch {
    Write-Host "No write access to $($webDirs[0])." -ForegroundColor Red
    Write-Host "Reopen Windows Terminal as Administrator, or move the folder out of Program Files."
    exit 1
}

function Backup($file) {
    if ((Test-Path $file) -and -not (Test-Path "$file.bak")) { Copy-Item $file "$file.bak" }
}

$config = @'
{
  "render":  { "targetFps": 60, "renderScale": 0.9, "octaves": 6, "adaptiveQuality": true,
               "powerPreference": "high-performance", "antialias": false },
  "palette": { "void": "#04060c", "tide": "#0b2233", "verdant": "#35e3a0",
               "iris": "#6e5bff", "frost": "#cfe9ff" },
  "aurora":  { "intensity": 1.6, "speed": 0.16, "height": 0.95 },
  "horizon": { "y": 0.30, "glow": 1.2, "reflection": 0.65 },
  "stars":   { "density": 1.0, "twinkle": 0.9 },
  "motes":   { "count": 1600, "color": "#cfe9ff", "size": 3.4, "drift": 0.9, "opacity": 0.8 },
  "finish":  { "grain": 0.03, "vignette": 0.35 },
  "hud":     { "enabled": false, "corner": "bottom-right", "clock24h": true, "locale": "en-CA" }
}
'@

# Whitespace-independent literal swaps: lower frequency = wider waves.
$shaderEdits = @(
    @{ Old = '(warp - 0.5) * 1.15';     New = '(warp - 0.5) * 2.2'  },  # domain warp
    @{ Old = 'q.x * 3.4 + t * 0.31';    New = 'q.x * 1.6 + t * 0.31' }, # curtain width
    @{ Old = 'q.x * 24.0 + seed * 5.0'; New = 'q.x * 12.0 + seed * 5.0' }, # ray width
    @{ Old = 't * 0.71, 0.44) * 0.44;'
       New  = "t * 0.71, 0.44) * 0.44`n                 + curtain(sky * 0.55 + vec2(5.1, 0.0), t * 0.43, 2.7) * 0.35;" }
)

foreach ($dir in $webDirs) {
    Write-Host "`n$dir" -ForegroundColor Cyan

    $cfg = Join-Path $dir "config.json"
    Backup $cfg
    Set-Content -Path $cfg -Value $config -Encoding utf8
    Write-Host "  config.json  written" -ForegroundColor Green

    $sky = Join-Path $dir "js\sky.js"
    if (-not (Test-Path $sky)) { Write-Host "  js\sky.js    not found - skipped" -ForegroundColor Yellow; continue }

    Backup $sky
    $text = Get-Content $sky -Raw
    foreach ($edit in $shaderEdits) {
        if ($text.Contains($edit.New) -and -not $text.Contains($edit.Old)) {
            Write-Host "  already applied: $($edit.Old)" -ForegroundColor DarkGray
        } elseif ($text.Contains($edit.Old)) {
            $text = $text.Replace($edit.Old, $edit.New)
            Write-Host "  patched: $($edit.Old)" -ForegroundColor Green
        } else {
            Write-Host "  NOT FOUND: $($edit.Old)" -ForegroundColor Red
        }
    }
    Set-Content -Path $sky -Value $text -Encoding utf8 -NoNewline
}

Write-Host "`nDone. Reload scene from the tray icon." -ForegroundColor Green
Write-Host "If it stutters, drop octaves to 5 in config.json before letting the ladder shrink resolution."
