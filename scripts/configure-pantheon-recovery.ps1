[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$privateRoot = Join-Path $root "private"
$credentialPath = Join-Path $privateRoot "runtime-credentials.json"

function New-SecretToken([int]$Bytes = 48) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) }
  finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Protect-LocalValue([string]$Value) {
  return ConvertFrom-SecureString (ConvertTo-SecureString $Value -AsPlainText -Force)
}

if ([string]::IsNullOrWhiteSpace($Destination)) {
  $oneDrive = [Environment]::GetEnvironmentVariable("OneDrive", "Process")
  if ([string]::IsNullOrWhiteSpace($oneDrive)) {
    $oneDrive = Join-Path $env:USERPROFILE "OneDrive"
  }
  $Destination = Join-Path $oneDrive "Pantheon-Backups"
}
$Destination = [IO.Path]::GetFullPath($Destination)

$profile = [ordered]@{}
if (Test-Path -LiteralPath $credentialPath) {
  $existing = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
  foreach ($property in $existing.PSObject.Properties) {
    $profile[$property.Name] = $property.Value
  }
}

if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
  $profile.backupPassphraseProtected = Protect-LocalValue (New-SecretToken 48)
}
if ([string]::IsNullOrWhiteSpace([string]$profile.privacyHashKeyProtected)) {
  $profile.privacyHashKeyProtected = Protect-LocalValue (New-SecretToken 32)
}
$profile.backupDestination = $Destination
$profile.recoveryConfiguredAt = [DateTime]::UtcNow.ToString("o")

New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$profile | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $credentialPath -Encoding utf8

Write-Host "Pantheon recovery encryption is configured for this Windows account."
Write-Host "Backup destination: $Destination"
Write-Host "No secret value was displayed or written to the repository."
