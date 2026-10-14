# First Light installer for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/codingsushi79/first-light/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = 'codingsushi79/first-light'
Write-Host '==> Looking up the latest release of First Light...' -ForegroundColor Cyan
$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
if (-not $asset) { throw 'No Windows installer in the latest release.' }
$out = Join-Path $env:TEMP $asset.name
Write-Host "==> Downloading $($asset.name)..." -ForegroundColor Cyan
Invoke-WebRequest $asset.browser_download_url -OutFile $out
Write-Host '==> Installing (per-user, no admin needed)...' -ForegroundColor Cyan
Start-Process $out -ArgumentList '/S' -Wait
Remove-Item $out -ErrorAction SilentlyContinue
Write-Host '==> Installed. Find "First Light" in the Start menu.' -ForegroundColor Green
