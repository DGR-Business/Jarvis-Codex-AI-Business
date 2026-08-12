[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$Destination,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")

$profile = Read-PantheonRecoveryCredential
if (-not $profile) {
  throw "Pantheon recovery is not configured. Run scripts\configure-pantheon-recovery.ps1 once."
}
if (-not $VerifyOnly -and [string]::IsNullOrWhiteSpace($Destination)) {
  throw "A restore destination is required unless -VerifyOnly is used."
}

$sourcePath = [IO.Path]::GetFullPath($Source)
$restoreScript = Join-Path $PSScriptRoot "restore-runtime.js"
try {
  $nodeCommand = @(Get-Command -Name "node" -CommandType Application -ErrorAction Stop)[0]
  $nodeExecutable = [IO.Path]::GetFullPath([string]$nodeCommand.Source)
} catch {
  throw "Pantheon could not locate the Node.js application required for recovery verification."
}
$keyCandidates = @(
  [pscustomobject]@{
    keyId = [string]$profile.activeKeyId
    passphrase = [string]$profile.backupPassphrase
    role = "active"
  }
)
foreach ($legacy in @($profile.legacyBackupKeys)) {
  $keyCandidates += [pscustomobject]@{
    keyId = [string]$legacy.keyId
    passphrase = [string]$legacy.passphrase
    role = "legacy-restore-only"
  }
}

$previousPantheon = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
$previousJarvis = [Environment]::GetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", "Process")
$previousNodeNoWarnings = [Environment]::GetEnvironmentVariable("NODE_NO_WARNINGS", "Process")
try {
  [Environment]::SetEnvironmentVariable("NODE_NO_WARNINGS", "1", "Process")
  $selectedKey = $null
  $verificationOutput = $null
  foreach ($candidate in $keyCandidates) {
    [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", [string]$candidate.passphrase, "Process")
    [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $null, "Process")
    $candidateOutput = $null
    $candidateExitCode = $null
    $candidateInvocationSucceeded = $false
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      # Windows PowerShell 5.1 promotes redirected native stderr to an ErrorRecord.
      # Keep the probe non-terminating so a wrong active key can advance to a
      # retained restore-only key, then immediately restore fail-closed behavior.
      $ErrorActionPreference = "Continue"
      $candidateOutput = & $nodeExecutable $restoreScript --source $sourcePath --verify-only 2>&1
      $candidateInvocationSucceeded = $?
      $candidateExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($candidateInvocationSucceeded -and $candidateExitCode -eq 0) {
      $selectedKey = $candidate
      $verificationOutput = $candidateOutput
      break
    }
  }
  if (-not $selectedKey) {
    throw "Pantheon could not authenticate this backup with its active or retained legacy recovery keys."
  }

  if ($VerifyOnly) {
    $verificationOutput | Write-Output
    Write-Host "Verified with recovery key ID $($selectedKey.keyId) ($($selectedKey.role))."
    return
  }

  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", [string]$selectedKey.passphrase, "Process")
  & $nodeExecutable $restoreScript --source $sourcePath --destination ([IO.Path]::GetFullPath($Destination))
  if (-not $? -or $LASTEXITCODE -ne 0) { throw "Pantheon restore failed." }
  Write-Host "Restored with recovery key ID $($selectedKey.keyId) ($($selectedKey.role))."
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPantheon, "Process")
  [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $previousJarvis, "Process")
  [Environment]::SetEnvironmentVariable("NODE_NO_WARNINGS", $previousNodeNoWarnings, "Process")
}
