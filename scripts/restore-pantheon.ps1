[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [Parameter(Mandatory = $true)]
  [string]$Destination,
  [switch]$VerifyOnly
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
  throw "Pantheon recovery is not configured."
}
$profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
  throw "Pantheon recovery encryption is not configured."
}

$previousPassphrase = [Environment]::GetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", "Process")
try {
  [Environment]::SetEnvironmentVariable(
    "PANTHEON_BACKUP_PASSPHRASE",
    (Unprotect-LocalValue ([string]$profile.backupPassphraseProtected)),
    "Process"
  )
  $arguments = @((Join-Path $PSScriptRoot "restore-runtime.js"), "--source", ([IO.Path]::GetFullPath($Source)))
  if ($VerifyOnly) {
    $arguments += "--verify-only"
  } else {
    $arguments += @("--destination", ([IO.Path]::GetFullPath($Destination)))
  }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Pantheon restore failed." }
} finally {
  [Environment]::SetEnvironmentVariable("PANTHEON_BACKUP_PASSPHRASE", $previousPassphrase, "Process")
}
