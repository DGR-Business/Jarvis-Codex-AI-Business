[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")

$profile = Read-PantheonRecoveryCredential
if (-not $profile) {
  throw "Pantheon recovery is not configured. Run scripts\configure-pantheon-recovery.ps1 once."
}

$previousPantheon = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
$previousJarvis = [Environment]::GetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", "Process")
$previousDestination = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_DESTINATION", "Process")
try {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", [string]$profile.backupPassphrase, "Process")
  [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $null, "Process")
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_DESTINATION", [string]$profile.backupDestination, "Process")
  & node (Join-Path $PSScriptRoot "doctor.js") --operations-ready
  if ($LASTEXITCODE -ne 0) { throw "Pantheon is not operations-ready." }
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPantheon, "Process")
  [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $previousJarvis, "Process")
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_DESTINATION", $previousDestination, "Process")
}
