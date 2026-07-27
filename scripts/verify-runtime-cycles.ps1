[CmdletBinding()]
param(
  [ValidateRange(1, 20)]
  [int]$Cycles = 10,
  [ValidateRange(1024, 65534)]
  [int]$ControlPort = 61500,
  [ValidateRange(1025, 65535)]
  [int]$WorkingPort = 61501,
  [ValidateRange(30, 180)]
  [int]$CycleTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
$stateRoot = Get-PantheonStateRoot -Root $root
$controlMetadataPath = Get-PantheonRuntimePath -StateRoot $stateRoot -Port $ControlPort
$workingMetadataPath = Get-PantheonRuntimePath -StateRoot $stateRoot -Port $WorkingPort

function Unprotect-LocalValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($CycleTimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $FailureMessage
}

if ($ControlPort -eq $WorkingPort) {
  throw "ControlPort and WorkingPort must be different."
}
if (-not (Test-PantheonPortAvailable -Port $ControlPort) -or -not (Test-PantheonPortAvailable -Port $WorkingPort)) {
  throw "Lifecycle proof ports must be free before the test starts."
}

$results = @()
try {
  for ($cycle = 1; $cycle -le $Cycles; $cycle += 1) {
    & (Join-Path $PSScriptRoot "start-pantheon-control.ps1") `
      -Port $ControlPort `
      -WorkingPort $WorkingPort `
      -NoOpen `
      -LifecycleProof

    $metadata = Read-PantheonMetadata -Path $controlMetadataPath
    if (-not $metadata) { throw "Cycle $cycle did not create a control ownership record." }
    $bootstrapToken = Unprotect-LocalValue ([string]$metadata.bootstrapProtected)
    $controlToken = Unprotect-LocalValue ([string]$metadata.controlProtected)
    $origin = "http://127.0.0.1:$ControlPort"
    $webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $session = Invoke-RestMethod `
      -Uri "$origin/api/session" `
      -Method Post `
      -TimeoutSec $CycleTimeoutSeconds `
      -WebSession $webSession `
      -Headers @{ Origin = $origin } `
      -ContentType "application/json" `
      -Body (@{ bootstrap = $bootstrapToken } | ConvertTo-Json -Compress)

    $standbyHealth = Invoke-RestMethod -Uri "$origin/api/health" -Method Get
    if ([int]$standbyHealth.memoryMb -ge 100) {
      throw "Cycle $cycle standby memory was $($standbyHealth.memoryMb) MB; target is below 100 MB."
    }

    $working = Invoke-RestMethod `
      -Uri "$origin/api/control/start" `
      -Method Post `
      -TimeoutSec $CycleTimeoutSeconds `
      -WebSession $webSession `
      -Headers @{ Origin = $origin; "x-pantheon-csrf" = [string]$session.csrfToken } `
      -ContentType "application/json" `
      -Body "{}"
    if (-not $working.operatorUrl.StartsWith("http://127.0.0.1:$WorkingPort/")) {
      throw "Cycle $cycle did not return the isolated working-runtime URL."
    }
    Wait-Until `
      -Condition { [bool](Get-PantheonHealth -Port $WorkingPort) } `
      -FailureMessage "Cycle $cycle working runtime did not become healthy."

    Invoke-RestMethod `
      -Uri "$origin/api/control/return-to-standby" `
      -Method Post `
      -TimeoutSec $CycleTimeoutSeconds `
      -Headers @{ "x-pantheon-standby" = $controlToken } `
      -ContentType "application/json" `
      -Body "{}" | Out-Null
    Wait-Until `
      -Condition { (Test-PantheonPortAvailable -Port $WorkingPort) -and -not (Test-Path -LiteralPath $workingMetadataPath) } `
      -FailureMessage "Cycle $cycle did not return cleanly to standby."

    & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $ControlPort
    Wait-Until `
      -Condition {
        (Test-PantheonPortAvailable -Port $ControlPort) `
          -and (Test-PantheonPortAvailable -Port $WorkingPort) `
          -and -not (Test-Path -LiteralPath $controlMetadataPath) `
          -and -not (Test-Path -LiteralPath $workingMetadataPath)
      } `
      -FailureMessage "Cycle $cycle left a Pantheon process, occupied port, or ownership record."

    $results += [pscustomobject][ordered]@{
      cycle = $cycle
      standbyMemoryMb = [int]$standbyHealth.memoryMb
      workingStarted = $true
      returnedToStandby = $true
      fullyStopped = $true
    }
  }
} finally {
  foreach ($cleanupPort in @($WorkingPort, $ControlPort)) {
    try { & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $cleanupPort }
    catch { Write-Warning $_.Exception.Message }
  }
}

[ordered]@{
  ok = $true
  cycles = $Cycles
  controlPort = $ControlPort
  workingPort = $WorkingPort
  maximumStandbyMemoryMb = [int](($results | Measure-Object -Property standbyMemoryMb -Maximum).Maximum)
  results = $results
} | ConvertTo-Json -Depth 5
