[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5051
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $root "tmp\jarvis-server.pid"
$expectedDbPath = [IO.Path]::GetFullPath((Join-Path $root "data\runtime.sqlite"))
$healthUrl = "http://127.0.0.1:$Port/api/health"

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
} catch {
  $health = $null
}

if (-not (Test-Path -LiteralPath $pidPath)) {
  if ($health -and $health.ok -eq $true) {
    throw "Jarvis is running, but it was started another way. Close that terminal or ask Jarvis to stop it safely."
  }
  Write-Host "Jarvis is already stopped."
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
  if ($process.ProcessName -ne "node") {
    throw "The saved Jarvis process ID now belongs to another program, so it was not stopped."
  }
  if (-not $health -or $health.ok -ne $true -or [IO.Path]::GetFullPath([string]$health.dbPath) -ne $expectedDbPath) {
    throw "The saved process is not serving this Jarvis workspace, so it was not stopped."
  }
  Stop-Process -Id $serverPid
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (-not (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { break }
  }
  if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
    Stop-Process -Id $serverPid -Force
  }
}
Remove-Item -LiteralPath $pidPath -Force
Write-Host "Jarvis has stopped."
