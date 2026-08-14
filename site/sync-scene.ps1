$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root "src\Backdrop\web"
$dst = Join-Path $PSScriptRoot "public\scene"

New-Item -ItemType Directory -Force -Path (Join-Path $dst "js"), (Join-Path $dst "vendor") | Out-Null
Copy-Item (Join-Path $src "index.html") (Join-Path $dst "index.html") -Force
Copy-Item (Join-Path $src "style.css") (Join-Path $dst "style.css") -Force
Copy-Item (Join-Path $src "config.json") (Join-Path $dst "config.json") -Force
foreach ($name in @("config.js", "host.js", "hud.js", "main.js", "motes.js", "sky.js", "scenes.js", "scenes-meta.js", "palettes.js", "audio.js", "pulse.js", "panel.js", "console-main.js", "ascii.js")) {
  Copy-Item (Join-Path $src "js\$name") (Join-Path $dst "js\$name") -Force
}
Copy-Item (Join-Path $src "vendor\three.module.js") (Join-Path $dst "vendor\three.module.js") -Force
Copy-Item (Join-Path $src "vendor\three.core.min.js") (Join-Path $dst "vendor\three.core.min.js") -Force
Copy-Item (Join-Path $src "vendor\anime.es.js") (Join-Path $dst "vendor\anime.es.js") -Force
Copy-Item (Join-Path $src "console.html") (Join-Path $dst "console.html") -Force
Remove-Item (Join-Path $dst "live.html") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dst "js\panel.js") -Force -ErrorAction SilentlyContinue
Write-Host "Synced scene assets to public/scene"
