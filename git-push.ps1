<#
.SYNOPSIS
  Initialises the repo if needed, commits, and pushes.

.DESCRIPTION
  Adds a Co-Authored-By trailer for Claude, which is the convention Anthropic publishes
  for attributing AI-assisted work. Pass -NoClaudeTrailer for commits that are yours
  alone. See CREDITS.md.

.EXAMPLE
  .\git-push.ps1 -Remote https://github.com/you/backdrop.git -Message "Initial commit"

.EXAMPLE
  .\git-push.ps1 -Message "Fix z-order after re-parenting"
#>
[CmdletBinding()]
param(
    [string]$Message = "Update Backdrop",
    [string]$Remote  = "",
    [string]$Branch  = "main",
    [switch]$NoClaudeTrailer
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "git is not on PATH. Install it from https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

# --- repo ---------------------------------------------------------------------
if (-not (Test-Path ".git")) {
    Write-Host "Initialising repository..." -ForegroundColor Cyan
    git init -b $Branch | Out-Null
}

if (-not (git config user.name)) {
    Write-Host "git has no identity configured. Run these once, then retry:" -ForegroundColor Red
    Write-Host '  git config --global user.name  "Your Name"'
    Write-Host '  git config --global user.email "you@example.com"'
    exit 1
}

# --- remote -------------------------------------------------------------------
if ($Remote) {
    if (git remote | Select-String -Quiet '^origin$') {
        git remote set-url origin $Remote
    } else {
        git remote add origin $Remote
    }
    Write-Host "origin -> $Remote" -ForegroundColor DarkGray
}

if (-not (git remote | Select-String -Quiet '^origin$')) {
    Write-Host "No remote set. Create an empty repo on GitHub, then:" -ForegroundColor Red
    Write-Host "  .\git-push.ps1 -Remote https://github.com/you/backdrop.git"
    exit 1
}

# --- commit -------------------------------------------------------------------
git add -A

if (-not (git status --porcelain)) {
    Write-Host "Nothing to commit." -ForegroundColor Yellow
} else {
    $body = $Message
    if (-not $NoClaudeTrailer) {
        # Blank line before trailers, per git convention.
        $body = "$Message`n`nCo-Authored-By: Claude <noreply@anthropic.com>"
    }

    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $body -Encoding utf8
    git commit -F $tmp | Out-Null
    Remove-Item $tmp

    Write-Host "Committed: $Message" -ForegroundColor Green
    if (-not $NoClaudeTrailer) { Write-Host "  + Co-Authored-By: Claude <noreply@anthropic.com>" -ForegroundColor DarkGray }
}

# --- push ---------------------------------------------------------------------
Write-Host "Pushing to origin/$Branch..." -ForegroundColor Cyan
git push -u origin $Branch

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push failed. Common causes:" -ForegroundColor Red
    Write-Host "  - Not authenticated. Install GitHub CLI and run 'gh auth login',"
    Write-Host "    or use a personal access token as the password."
    Write-Host "  - The remote already has commits. Try 'git pull --rebase origin $Branch' first."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Pushed." -ForegroundColor Green
