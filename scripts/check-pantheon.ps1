[CmdletBinding()]
param()

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
  throw "Pantheon recovery is not configured."
}
$profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
  throw "Pantheon recovery encryption is not configured."
}

$previousPassphrase = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
$previousDestination = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_DESTINATION", "Process")
try {
  [Environment]::SetEnvironmentVariable(
    "PANTHEON_BACKUP_PASSPHRASE",
    (Unprotect-LocalValue ([string]$profile.backupPassphraseProtected)),
    "Process"
  )
  [Environment]::SetEnvironmentVariable(
    "PANTHEON_BACKUP_DESTINATION",
    ([string]$profile.backupDestination),
    "Process"
  )
  & node (Join-Path $PSScriptRoot "doctor.js") --operations-ready
  if ($LASTEXITCODE -ne 0) { throw "Pantheon is not operations-ready." }
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPassphrase, "Process")
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_DESTINATION", $previousDestination, "Process")
}
