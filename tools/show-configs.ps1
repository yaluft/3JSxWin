<#
  show-configs.ps1 — finds every config*.json under the repo and renders
  them all into a single self-contained HTML page, then opens it.

  .\show-configs.ps1
  .\show-configs.ps1 -Root "C:\Program Files\Win11Backdrop"
  .\show-configs.ps1 -Out "$env:TEMP\configs.html"   # custom output path
#>
[CmdletBinding()]
param(
    [string]$Root = $PSScriptRoot,
    [string]$Out  = "$PSScriptRoot\configs.html"
)

$ErrorActionPreference = "Stop"

# ── collect every config*.json, skip node_modules / .git ──────────────────────
$files = Get-ChildItem -Path $Root -Recurse -Filter "config*.json" |
         Where-Object { $_.FullName -notmatch '\\(node_modules|\.git)\\' } |
         Sort-Object FullName

if (-not $files) { Write-Host "No config*.json found under $Root" -ForegroundColor Red; exit 1 }

# ── build JSON array of { path, content } objects ─────────────────────────────
$entries = $files | ForEach-Object {
    $rel  = $_.FullName.Substring($Root.Length).TrimStart('\','/')
    $text = Get-Content $_.FullName -Raw
    # validate JSON — skip silently if unparseable
    try   { $null = $text | ConvertFrom-Json }
    catch { Write-Warning "Skipping (invalid JSON): $rel"; return }
    [PSCustomObject]@{ path = $rel; content = $text }
}

$jsonData = $entries | ConvertTo-Json -Depth 3 -Compress
# escape for embedding in a JS string
$jsonData = $jsonData -replace '\\', '\\' -replace '"', '\"' -replace "`r`n|`n", '\n'

# ── emit HTML ─────────────────────────────────────────────────────────────────
$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Win11Backdrop — config files</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,"Segoe UI",system-ui,sans-serif;font-size:14px;
       line-height:1.6;background:#0d1117;color:#e6edf3;padding:24px}
  h1{font-size:18px;font-weight:600;margin-bottom:4px;color:#e6edf3}
  .sub{color:#7d8590;font-size:12px;margin-bottom:20px}
  .search{width:100%;max-width:520px;padding:7px 12px;border-radius:6px;
          border:1px solid #30363d;background:#161b22;color:#e6edf3;font-size:13px;
          margin-bottom:20px;outline:none}
  .search:focus{border-color:#388bfd}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;
        margin-bottom:14px;overflow:hidden}
  .card-head{display:flex;align-items:center;justify-content:space-between;
             padding:10px 14px;cursor:pointer;user-select:none;gap:8px}
  .card-head:hover{background:#1c2128}
  .path{font-size:12px;font-family:ui-monospace,monospace;color:#79c0ff;
        word-break:break-all;flex:1}
  .toggle{font-size:11px;color:#7d8590;white-space:nowrap;flex-shrink:0}
  .body{display:none;padding:0 14px 14px}
  .body.open{display:block}
  pre{background:#0d1117;border:1px solid #21262d;border-radius:6px;
      padding:12px;font-family:ui-monospace,monospace;font-size:12px;
      overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#e6edf3;
      max-height:480px;overflow-y:auto}
  .key{color:#79c0ff}
  .str{color:#a5d6ff}
  .num{color:#f2cc60}
  .bool{color:#ff7b72}
  .null{color:#7d8590}
  .none{color:#7d8590;font-style:italic;padding:8px 0}
  footer{margin-top:32px;padding-top:12px;border-top:1px solid #21262d;
         text-align:center;font-size:11px;color:#7d8590}
</style>
</head>
<body>
<h1>Win11Backdrop — config files</h1>
<p class="sub" id="sub"></p>
<input class="search" type="text" placeholder="Filter by path or key…" id="q" oninput="filter()">
<div id="list"></div>
<footer>Win11Backdrop · generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')</footer>
<script>
const raw = "$jsonData";
const data = JSON.parse(raw);
document.getElementById('sub').textContent = data.length + ' file' + (data.length===1?'':'s') + ' found';

function colorize(json) {
  return json
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      m => {
        if (/^"/.test(m)) return /:$/.test(m)
          ? '<span class="key">'+m+'</span>'
          : '<span class="str">'+m+'</span>';
        if (/true|false/.test(m)) return '<span class="bool">'+m+'</span>';
        if (/null/.test(m))       return '<span class="null">'+m+'</span>';
        return '<span class="num">'+m+'</span>';
      });
}

function build(items) {
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<p class="none">No matches.</p>'; return;
  }
  items.forEach((f,i) => {
    const pretty = JSON.stringify(JSON.parse(f.content), null, 2);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-head" onclick="toggle('+i+')">' +
        '<span class="path">'+f.path+'</span>' +
        '<span class="toggle" id="tog'+i+'">▶ expand</span>' +
      '</div>' +
      '<div class="body" id="body'+i+'">' +
        '<pre>'+colorize(pretty)+'</pre>' +
      '</div>';
    list.appendChild(card);
  });
}

function toggle(i) {
  const b = document.getElementById('body'+i);
  const t = document.getElementById('tog'+i);
  const open = b.classList.toggle('open');
  t.textContent = open ? '▼ collapse' : '▶ expand';
}

function filter() {
  const q = document.getElementById('q').value.toLowerCase();
  build(q ? data.filter(f => f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)) : data);
}

build(data);
</script>
</body>
</html>
"@

Set-Content -Path $Out -Value $html -Encoding utf8
Write-Host "Written: $Out" -ForegroundColor Green

Start-Process $Out
