[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$legacyCredentialPath = Join-Path $root "private\runtime-credentials.json"
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")

function New-SecretToken([int]$Bytes = 48) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) }
  finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Unprotect-LegacyValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-RecoveryEnvironmentValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
  }
  return $value
}

if ([string]::IsNullOrWhiteSpace($Destination)) {
  $oneDrive = [Environment]::GetEnvironmentVariable("OneDrive", "Process")
  if ([string]::IsNullOrWhiteSpace($oneDrive)) {
    $oneDrive = Join-Path $env:USERPROFILE "OneDrive"
  }
  $Destination = Join-Path $oneDrive "Pantheon-Backups"
}
$Destination = [IO.Path]::GetFullPath($Destination)

$existingRecovery = Read-PantheonRecoveryCredential
$legacyProfile = $null
$legacyProfilePassphrase = ""
$legacyPrivacyHashKey = ""
if (Test-Path -LiteralPath $legacyCredentialPath) {
  $legacyProfile = Get-Content -LiteralPath $legacyCredentialPath -Raw | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace([string]$legacyProfile.backupPassphraseProtected)) {
    try { $legacyProfilePassphrase = Unprotect-LegacyValue ([string]$legacyProfile.backupPassphraseProtected) }
    catch { throw "Pantheon found its legacy recovery profile but could not unlock it. It refused to rotate the backup key." }
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$legacyProfile.privacyHashKeyProtected)) {
    try { $legacyPrivacyHashKey = Unprotect-LegacyValue ([string]$legacyProfile.privacyHashKeyProtected) }
    catch { throw "Pantheon found its legacy privacy key but could not unlock it. It refused to replace it silently." }
  }
}

$environmentKeys = @(
  @(
    Get-RecoveryEnvironmentValue "PANTHEON_BACKUP_PASSPHRASE"
    Get-RecoveryEnvironmentValue "JARVIS_BACKUP_PASSPHRASE"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
)

$activePassphrase = ""
$privacyHashKey = ""
$legacyPassphrases = @()
if ($existingRecovery) {
  $activePassphrase = [string]$existingRecovery.backupPassphrase
  $privacyHashKey = [string]$existingRecovery.privacyHashKey
  $legacyPassphrases += @($existingRecovery.legacyBackupKeys | ForEach-Object { [string]$_.passphrase })
} elseif (-not [string]::IsNullOrWhiteSpace($legacyProfilePassphrase)) {
  $activePassphrase = $legacyProfilePassphrase
  $privacyHashKey = $legacyPrivacyHashKey
} elseif ($environmentKeys.Count -gt 0) {
  $activePassphrase = [string]$environmentKeys[0]
}

$activeKeyId = if ([string]::IsNullOrWhiteSpace($activePassphrase)) {
  ""
} else {
  Get-PantheonBackupKeyId -Passphrase $activePassphrase
}
foreach ($candidate in @($legacyProfilePassphrase) + @($environmentKeys)) {
  if (
    -not [string]::IsNullOrWhiteSpace([string]$candidate) -and
    -not [string]::Equals(
      (Get-PantheonBackupKeyId -Passphrase ([string]$candidate)),
      $activeKeyId,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    $legacyPassphrases += [string]$candidate
  }
}

if ([string]::IsNullOrWhiteSpace($activePassphrase)) {
  $existingBackups = if (Test-Path -LiteralPath $Destination) {
    @(Get-ChildItem -LiteralPath $Destination -Filter "*.jbackup" -File -ErrorAction SilentlyContinue)
  } else {
    @()
  }
  if ($existingBackups.Count -gt 0) {
    throw "Pantheon found existing encrypted backups but no recoverable key. It refused to generate a replacement key."
  }
  $activePassphrase = New-SecretToken 48
}
if ([string]::IsNullOrWhiteSpace($privacyHashKey)) {
  $privacyHashKey = New-SecretToken 32
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$credentialPath = Write-PantheonRecoveryCredential `
  -BackupPassphrase $activePassphrase `
  -PrivacyHashKey $privacyHashKey `
  -BackupDestination $Destination `
  -LegacyBackupPassphrases $legacyPassphrases
$configured = Read-PantheonRecoveryCredential

if ($legacyProfile) {
  $redacted = [ordered]@{}
  foreach ($property in $legacyProfile.PSObject.Properties) {
    if ($property.Name -notin @("backupPassphraseProtected", "privacyHashKeyProtected", "openAiApiKeyProtected")) {
      $redacted[$property.Name] = $property.Value
    }
  }
  $redacted.backupDestination = $Destination
  $redacted.recoveryCredentialPath = $credentialPath
  $redacted.recoveryCredentialKeyId = [string]$configured.activeKeyId
  $redacted.recoverySecretsMigratedAt = [DateTime]::UtcNow.ToString("o")
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($legacyCredentialPath, ($redacted | ConvertTo-Json -Depth 8), $utf8)
}

Write-Host "Pantheon recovery encryption is configured for this Windows account."
Write-Host "Backup destination: $Destination"
Write-Host "Recovery key ID: $($configured.activeKeyId)"
Write-Host "Legacy restore keys retained: $(@($configured.legacyBackupKeys).Count)"
Write-Host "No secret value was displayed or written to the repository."
