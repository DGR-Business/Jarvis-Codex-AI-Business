[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$credentialPath = Join-Path $root "private\runtime-credentials.json"

function Unprotect-LocalValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (-not (Test-Path -LiteralPath $credentialPath)) {
  throw "Pantheon recovery is not configured. Run scripts\configure-pantheon-recovery.ps1 once."
}
$profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
  throw "Pantheon recovery encryption is not configured."
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $Destination = [string]$profile.backupDestination
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
  throw "Pantheon backup destination is not configured."
}

$previousPassphrase = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
try {
  [Environment]::SetEnvironmentVariable(
    "PANTHEON_BACKUP_PASSPHRASE",
    (Unprotect-LocalValue ([string]$profile.backupPassphraseProtected)),
    "Process"
  )
  & node (Join-Path $PSScriptRoot "backup-runtime.js") --kind all --destination ([IO.Path]::GetFullPath($Destination))
  if ($LASTEXITCODE -ne 0) { throw "Pantheon backup failed." }
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPassphrase, "Process")
}
