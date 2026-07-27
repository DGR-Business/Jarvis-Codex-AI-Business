[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")

$profile = Read-PantheonRecoveryCredential
if (-not $profile) {
  throw "Pantheon recovery is not configured. Run scripts\configure-pantheon-recovery.ps1 once."
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $Destination = [string]$profile.backupDestination
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
  throw "Pantheon backup destination is not configured."
}

$previousPantheon = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
$previousJarvis = [Environment]::GetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", "Process")
try {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", [string]$profile.backupPassphrase, "Process")
  [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $null, "Process")
  & node (Join-Path $PSScriptRoot "backup-runtime.js") --kind all --destination ([IO.Path]::GetFullPath($Destination))
  if ($LASTEXITCODE -ne 0) { throw "Pantheon backup failed." }
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPantheon, "Process")
  [Environment]::SetEnvironmentVariable("JARVIS_BACKUP_PASSPHRASE", $previousJarvis, "Process")
}
