[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int[]]$Port = @(5051, 5052),
  [switch]$All,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
$stateRoot = Get-PantheonStateRoot -Root $root
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

$targetPorts = @($Port)
if ($All) {
  foreach ($file in Get-ChildItem -LiteralPath $stateRoot -File -ErrorAction SilentlyContinue) {
    if ($file.Name -match "^(?:pantheon|jarvis)-server-(\d+)\.json$") {
      $candidatePort = [int]$Matches[1]
      if ($candidatePort -ge 1 -and $candidatePort -le 65535) { $targetPorts += $candidatePort }
    }
  }
}
$targetPorts = @($targetPorts | Sort-Object -Unique)
$statuses = @($targetPorts | ForEach-Object {
  Get-PantheonRuntimeStatus -StateRoot $stateRoot -Port $_
})

if ($Json) {
  $statuses | ConvertTo-Json -Depth 5
  exit 0
}

foreach ($status in $statuses) {
  $label = switch ([string]$status.state) {
    "ready" { "READY" }
    "standby" { "STANDBY" }
    "rehearsal_ready" { "REHEARSAL READY" }
    "stopped" { "STOPPED" }
    "stale_metadata" { "STOPPED (STALE RECORD)" }
    default { "NEEDS ATTENTION" }
  }
  $processText = if ($null -ne $status.pid) { " PID $($status.pid)." } else { "" }
  Write-Host "Port $($status.port): $label.$processText $($status.detail)"
}
