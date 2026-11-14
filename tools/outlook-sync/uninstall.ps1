<#
  Removes the Outlook sync helper: stops it, deletes the Startup shortcut and its folder.
  Your mail and the tracker's data are not touched.
#>
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AI CV Portal Outlook Sync.lnk"
$dest = Join-Path $env:LOCALAPPDATA "AI-CV-Portal-Outlook-Sync"

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*AI-CV-Portal-Outlook-Sync*outlook-sync.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path $lnk) { Remove-Item $lnk }
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Write-Host "Outlook sync helper removed."
