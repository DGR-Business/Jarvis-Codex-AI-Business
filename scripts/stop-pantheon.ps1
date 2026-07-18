[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5051
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $root "tmp\pantheon-server-$Port.json"
$legacyRuntimePath = Join-Path $root "tmp\jarvis-server-$Port.json"
$healthUrl = "http://127.0.0.1:$Port/api/health"

function Unprotect-LocalValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (-not (Test-Path -LiteralPath $runtimePath) -and (Test-Path -LiteralPath $legacyRuntimePath)) {
  Move-Item -LiteralPath $legacyRuntimePath -Destination $runtimePath
}

if (-not (Test-Path -LiteralPath $runtimePath)) {
  try { $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 } catch { $health = $null }
  if ($health -and $health.ok -eq $true) {
    throw "Pantheon is running on port $Port, but this launcher does not own it. It was not stopped."
  }
  Write-Host "Pantheon is already stopped."
  exit 0
}

$metadata = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
$serverPid = [int]$metadata.pid
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $runtimePath -Force
  Write-Host "Pantheon was already stopped; its stale ownership file was removed."
  exit 0
}

try { $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 } catch { $health = $null }
if (-not $health -or [string]$health.instanceId -ne [string]$metadata.instanceId) {
  throw "The saved process is not the Pantheon instance owned by this launcher, so it was not stopped."
}

$controlToken = Unprotect-LocalValue ([string]$metadata.controlProtected)
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/runtime/shutdown" -Method Post -ContentType "application/json" -Headers @{ "x-pantheon-control" = $controlToken; "x-jarvis-control" = $controlToken } -Body "{}" -TimeoutSec 4 | Out-Null
} catch {
  throw "Pantheon did not accept a graceful stop request. The process was left running for safety."
}

for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if (-not (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { break }
}
if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
  throw "Pantheon did not finish its graceful shutdown. The process was left running for review."
}

Remove-Item -LiteralPath $runtimePath -Force
Write-Host "Pantheon has stopped cleanly."
