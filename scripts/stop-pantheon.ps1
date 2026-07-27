[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int[]]$Port = @(5051),
  [switch]$All,
  [switch]$LauncherLockHeld,
  [ValidateRange(1, 60)]
  [int]$GracefulTimeoutSeconds = 8
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
$stateRoot = Get-PantheonStateRoot -Root $root
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

function Unprotect-LocalValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-RecordedDescendants($Metadata) {
  if ($Metadata.PSObject.Properties.Name -contains "shutdownDescendants") {
    return @($Metadata.shutdownDescendants)
  }
  return @()
}

function Stop-OnePantheon {
  param(
    [Parameter(Mandatory = $true)][int]$TargetPort,
    [switch]$LockAlreadyHeld
  )

  $runtimePath = Get-PantheonRuntimePath -StateRoot $stateRoot -Port $TargetPort
  $legacyRuntimePath = Join-Path $stateRoot "jarvis-server-$TargetPort.json"
  $healthUrl = "http://127.0.0.1:$TargetPort/api/health"
  $launcherLock = $null
  if (-not $LockAlreadyHeld) {
    $launcherLock = Enter-PantheonLauncherLock -StateRoot $stateRoot -Port $TargetPort
  }

  try {
    if (-not (Test-Path -LiteralPath $runtimePath) -and (Test-Path -LiteralPath $legacyRuntimePath)) {
      Move-Item -LiteralPath $legacyRuntimePath -Destination $runtimePath
    }

    $metadata = Read-PantheonMetadata -Path $runtimePath
    $health = Get-PantheonHealth -Port $TargetPort
    if ($metadata -and ($metadata.PSObject.Properties.Name -contains "invalid") -and $metadata.invalid -eq $true) {
      if ($health -or -not (Test-PantheonPortAvailable -Port $TargetPort)) {
        throw "Pantheon found unreadable ownership data while port $TargetPort is active. It did not stop that process."
      }
      Remove-Item -LiteralPath $runtimePath -Force
      Write-Host "Pantheon on port $TargetPort was already stopped; unreadable stale ownership data was removed."
      return
    }

    if (-not $metadata) {
      if ($health) {
        throw "A Pantheon-compatible service is running on port $TargetPort, but this launcher does not own it. It was not stopped."
      }
      if (-not (Test-PantheonPortAvailable -Port $TargetPort)) {
        throw "Port $TargetPort is occupied by an unknown process. Pantheon did not stop it."
      }
      Write-Host "Pantheon on port $TargetPort is already stopped."
      return
    }

    $serverPid = [int]$metadata.pid
    $ownership = Test-PantheonProcessOwnership -Metadata $metadata -Port $TargetPort -Health $health
    $recordedDescendants = Get-RecordedDescendants -Metadata $metadata

    if (-not $ownership.owned) {
      if (
        $ownership.reason -eq "process_identity_changed" -and
        -not $health -and
        (Test-PantheonPortAvailable -Port $TargetPort)
      ) {
        Remove-Item -LiteralPath $runtimePath -Force
        Write-Host "Pantheon on port $TargetPort was already stopped; Windows had reused its old process ID, so only the stale launcher record was removed."
        return
      }
      if ($ownership.reason -ne "process_not_running") {
        throw "The saved Pantheon identity now points to a different Windows process ($($ownership.reason)). It was not stopped."
      }
      if ($health) {
        throw "Pantheon is responding on port $TargetPort, but its recorded process has exited. The live process was not stopped."
      }

      $remainingRecorded = @(Stop-PantheonCapturedProcesses -Snapshots $recordedDescendants)
      if ($remainingRecorded.Count -gt 0) {
        throw "Pantheon's recorded server exited, but $($remainingRecorded.Count) exact child process(es) could not be stopped. Ownership data was retained for another attempt."
      }
      if (-not (Wait-PantheonPortAvailable -Port $TargetPort -TimeoutSeconds 5)) {
        throw "Pantheon's recorded process has exited, but port $TargetPort is still occupied. The unknown process was not stopped."
      }
      Remove-Item -LiteralPath $runtimePath -Force
      Write-Host "Pantheon on port $TargetPort was already stopped; stale ownership data was removed."
      return
    }

    $rootSnapshot = $ownership.process
    $descendants = @(Get-PantheonDescendantSnapshots -RootProcessId $serverPid)
    $metadata | Add-Member -NotePropertyName shutdownStartedAt -NotePropertyValue ([DateTime]::UtcNow.ToString("o")) -Force
    $metadata | Add-Member -NotePropertyName shutdownDescendants -NotePropertyValue $descendants -Force
    Write-PantheonMetadata -Path $runtimePath -Metadata $metadata

    $gracefulRequested = $false
    if ($health -and [string]$health.instanceId -eq [string]$metadata.instanceId) {
      try {
        $controlToken = Unprotect-LocalValue ([string]$metadata.controlProtected)
        $shutdownRequest = @{
          Uri = "http://127.0.0.1:$TargetPort/api/runtime/shutdown"
          Method = "Post"
          ContentType = "application/json"
          Headers = @{ "x-pantheon-control" = $controlToken; "x-jarvis-control" = $controlToken }
          Body = "{}"
          TimeoutSec = 4
        }
        Invoke-RestMethod @shutdownRequest | Out-Null
        $gracefulRequested = $true
      } catch {
        Write-Warning "Pantheon could not complete its authenticated graceful-stop request. The exact recorded process tree will be stopped directly."
      }
    }

    if ($gracefulRequested) {
      [void](Wait-PantheonProcessExit -ProcessId $serverPid -TimeoutSeconds $GracefulTimeoutSeconds)
    }

    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
      $currentRoot = Get-PantheonProcessSnapshot -ProcessId $serverPid
      if (-not (Test-PantheonSnapshotMatches -Expected $rootSnapshot -Actual $currentRoot)) {
        throw "Pantheon's process identity changed during shutdown. The replacement process was not stopped."
      }
      $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
      & $taskkill /PID $serverPid /T /F | Out-Null
      if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) {
        throw "Windows could not terminate Pantheon's exact process tree. Try STOP PANTHEON.cmd from the same Windows permission level used to start it."
      }
      if (-not (Wait-PantheonProcessExit -ProcessId $serverPid -TimeoutSeconds 8)) {
        throw "Pantheon's exact server process did not exit after Windows terminated its process tree."
      }
    }

    $remainingDescendants = @(Stop-PantheonCapturedProcesses -Snapshots $descendants)
    if ($remainingDescendants.Count -gt 0) {
      throw "Pantheon's server stopped, but $($remainingDescendants.Count) exact child process(es) remain. Ownership data was retained so STOP PANTHEON.cmd can safely retry."
    }

    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
      throw "Pantheon's server process is still running after shutdown verification."
    }
    if (Get-PantheonHealth -Port $TargetPort) {
      throw "A service is still responding on Pantheon's port after its exact process exited. The new service was not stopped."
    }
    if (-not (Wait-PantheonPortAvailable -Port $TargetPort -TimeoutSeconds 8)) {
      throw "Pantheon's process exited, but port $TargetPort did not become available. No unrelated process was terminated."
    }

    Remove-Item -LiteralPath $runtimePath -Force
    Write-Host "Pantheon on port $TargetPort has stopped cleanly; its exact Windows process tree and port exit were verified."
  } finally {
    if ($launcherLock) { $launcherLock.Dispose() }
  }
}

if ($LauncherLockHeld -and $All) {
  throw "LauncherLockHeld cannot be combined with All."
}

$targetPorts = @()
if ($All) {
  foreach ($file in Get-ChildItem -LiteralPath $stateRoot -File -ErrorAction SilentlyContinue) {
    if ($file.Name -match "^(?:pantheon|jarvis)-server-(\d+)\.json$") {
      $candidatePort = [int]$Matches[1]
      if ($candidatePort -ge 1 -and $candidatePort -le 65535) { $targetPorts += $candidatePort }
    }
  }
  if ($PSBoundParameters.ContainsKey("Port")) { $targetPorts += $Port }
  $targetPorts = @($targetPorts | Sort-Object -Unique)
  if ($targetPorts.Count -eq 0) {
    Write-Host "Pantheon is already stopped; no launcher-owned Windows processes are recorded."
    exit 0
  }
} else {
  $targetPorts = @($Port | Sort-Object -Unique)
}

$failures = @()
foreach ($targetPort in $targetPorts) {
  try {
    Stop-OnePantheon -TargetPort $targetPort -LockAlreadyHeld:$LauncherLockHeld
  } catch {
    $failures += "Port ${targetPort}: $($_.Exception.Message)"
  }
}

if ($failures.Count -gt 0) {
  throw ($failures -join [Environment]::NewLine)
}
