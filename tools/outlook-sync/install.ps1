<#
  Installs the Outlook sync helper for the current Windows user: copies it to
  %LOCALAPPDATA%\AI-CV-Portal-Outlook-Sync and starts it hidden at every log-in through a
  Startup-folder shortcut. No admin rights needed. Run uninstall.ps1 to remove it.
#>
param([string]$Account = "rassemkadiri@live.de")
$ErrorActionPreference = "Stop"

$dest = Join-Path $env:LOCALAPPDATA "AI-CV-Portal-Outlook-Sync"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "outlook-sync.ps1") $dest
$script = Join-Path $dest "outlook-sync.ps1"

$launchArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Account `"$Account`""
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AI CV Portal Outlook Sync.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = (Get-Command powershell.exe).Source
$sh.Arguments = $launchArgs
$sh.WorkingDirectory = $dest
$sh.WindowStyle = 7   # minimized
$sh.Description = "Read-only Outlook sync for the AI CV Portal application tracker"
$sh.Save()

# Start it now too, unless it is already running.
$running = $false
try { $running = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:47321/health").StatusCode -eq 200 } catch {}
if (-not $running) { Start-Process powershell.exe -ArgumentList $launchArgs -WindowStyle Hidden }

Write-Host "Installed to $dest"
Write-Host "Starts automatically at log-in (shortcut: $lnk)."
