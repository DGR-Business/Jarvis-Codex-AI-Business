Set-StrictMode -Version 2.0

function Get-PantheonCredentialRoot {
  $override = [Environment]::GetEnvironmentVariable("PANTHEON_CREDENTIAL_ROOT", "Process")
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    return [IO.Path]::GetFullPath($override)
  }

  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA", "Process")
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  }
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw "Windows could not locate the current user's local application-data folder."
  }
  return [IO.Path]::GetFullPath((Join-Path $localAppData "Pantheon"))
}

function Get-PantheonOpenAICredentialPath {
  return Join-Path (Get-PantheonCredentialRoot) "openai-credential.json"
}

function Get-PantheonRecoveryCredentialPath {
  return Join-Path (Get-PantheonCredentialRoot) "recovery-credential.json"
}

function Protect-PantheonCurrentUserSecret {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Secret)
  return ConvertFrom-SecureString $Secret
}

function Unprotect-PantheonCurrentUserSecret {
  param([Parameter(Mandatory = $true)][string]$ProtectedValue)

  $secure = ConvertTo-SecureString $ProtectedValue
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Set-PantheonCredentialAcl {
  param([Parameter(Mandatory = $true)][string]$CredentialRoot)

  New-Item -ItemType Directory -Path $CredentialRoot -Force | Out-Null
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $aclTool = Get-Command icacls.exe -ErrorAction Stop
  & $aclTool.Source $CredentialRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Pantheon could not restrict its credential folder to this Windows account."
  }
}

function Get-PantheonBackupKeyId {
  param([Parameter(Mandatory = $true)][string]$Passphrase)

  $bytes = [Text.Encoding]::UTF8.GetBytes("pantheon-backup-key-v1`0$Passphrase")
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($bytes)
    return "pbk-$(([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()).Substring(0, 20))"
  } finally {
    $sha256.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Write-PantheonRecoveryCredential {
  param(
    [Parameter(Mandatory = $true)][string]$BackupPassphrase,
    [Parameter(Mandatory = $true)][string]$PrivacyHashKey,
    [Parameter(Mandatory = $true)][string]$BackupDestination,
    [string[]]$LegacyBackupPassphrases = @()
  )

  if ($BackupPassphrase.Length -lt 16) {
    throw "Pantheon's recovery passphrase must contain at least 16 characters."
  }

  $credentialRoot = Get-PantheonCredentialRoot
  $credentialPath = Get-PantheonRecoveryCredentialPath
  Set-PantheonCredentialAcl -CredentialRoot $credentialRoot
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $activeKeyId = Get-PantheonBackupKeyId -Passphrase $BackupPassphrase
  $legacyProfiles = @()
  $seenKeyIds = @{}
  $seenKeyIds[$activeKeyId] = $true
  foreach ($legacyPassphrase in @($LegacyBackupPassphrases)) {
    if ([string]::IsNullOrWhiteSpace([string]$legacyPassphrase) -or $legacyPassphrase.Length -lt 16) { continue }
    $legacyKeyId = Get-PantheonBackupKeyId -Passphrase $legacyPassphrase
    if ($seenKeyIds.ContainsKey($legacyKeyId)) { continue }
    $seenKeyIds[$legacyKeyId] = $true
    $legacySecure = ConvertTo-SecureString $legacyPassphrase -AsPlainText -Force
    $legacyProfiles += [ordered]@{
      keyId = $legacyKeyId
      passphraseProtected = Protect-PantheonCurrentUserSecret -Secret $legacySecure
      retainedFor = "legacy-backup-restore-only"
    }
  }

  $backupSecure = ConvertTo-SecureString $BackupPassphrase -AsPlainText -Force
  $privacySecure = ConvertTo-SecureString $PrivacyHashKey -AsPlainText -Force
  $profile = [ordered]@{
    version = 1
    storage = "windows-current-user-dpapi"
    windowsSid = $identity.User.Value
    activeBackupKeyId = $activeKeyId
    backupPassphraseProtected = Protect-PantheonCurrentUserSecret -Secret $backupSecure
    privacyHashKeyProtected = Protect-PantheonCurrentUserSecret -Secret $privacySecure
    legacyBackupKeys = $legacyProfiles
    backupDestination = [IO.Path]::GetFullPath($BackupDestination)
    configuredAt = [DateTime]::UtcNow.ToString("o")
  }

  $temporaryPath = "$credentialPath.$PID.$([guid]::NewGuid().ToString('N')).tmp"
  $utf8 = New-Object Text.UTF8Encoding($false)
  try {
    [IO.File]::WriteAllText($temporaryPath, ($profile | ConvertTo-Json -Depth 8), $utf8)
    Move-Item -LiteralPath $temporaryPath -Destination $credentialPath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
  return $credentialPath
}

function Read-PantheonRecoveryCredential {
  $credentialPath = Get-PantheonRecoveryCredentialPath
  if (-not (Test-Path -LiteralPath $credentialPath)) { return $null }

  $profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
  if ([string]$profile.storage -ne "windows-current-user-dpapi") {
    throw "Pantheon's recovery credential uses an unsupported storage format."
  }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not [string]::Equals([string]$profile.windowsSid, $currentSid, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Pantheon's recovery credential belongs to a different Windows account."
  }
  if ([string]::IsNullOrWhiteSpace([string]$profile.backupPassphraseProtected)) {
    throw "Pantheon's recovery credential does not contain an active backup key."
  }

  $activePassphrase = Unprotect-PantheonCurrentUserSecret -ProtectedValue ([string]$profile.backupPassphraseProtected)
  $activeKeyId = Get-PantheonBackupKeyId -Passphrase $activePassphrase
  if (
    -not [string]::IsNullOrWhiteSpace([string]$profile.activeBackupKeyId) -and
    -not [string]::Equals([string]$profile.activeBackupKeyId, $activeKeyId, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "Pantheon's protected recovery key does not match its identifier."
  }
  $legacyKeys = @()
  foreach ($legacy in @($profile.legacyBackupKeys)) {
    if ($null -eq $legacy -or [string]::IsNullOrWhiteSpace([string]$legacy.passphraseProtected)) { continue }
    $legacyPassphrase = Unprotect-PantheonCurrentUserSecret -ProtectedValue ([string]$legacy.passphraseProtected)
    $legacyKeys += [pscustomobject]@{
      keyId = Get-PantheonBackupKeyId -Passphrase $legacyPassphrase
      passphrase = $legacyPassphrase
      retainedFor = [string]$legacy.retainedFor
    }
  }
  $privacyHashKey = ""
  if (-not [string]::IsNullOrWhiteSpace([string]$profile.privacyHashKeyProtected)) {
    $privacyHashKey = Unprotect-PantheonCurrentUserSecret -ProtectedValue ([string]$profile.privacyHashKeyProtected)
  }

  return [pscustomobject]@{
    activeKeyId = $activeKeyId
    backupPassphrase = $activePassphrase
    privacyHashKey = $privacyHashKey
    legacyBackupKeys = $legacyKeys
    backupDestination = [string]$profile.backupDestination
    configuredAt = [string]$profile.configuredAt
    path = $credentialPath
  }
}

function Write-PantheonOpenAICredential {
  param(
    [Parameter(Mandatory = $true)][Security.SecureString]$ApiKey,
    [bool]$EnableLiveModels = $true,
    [bool]$EnableLiveResearch = $true,
    [bool]$EnableImageGeneration = $true
  )

  $credentialRoot = Get-PantheonCredentialRoot
  $credentialPath = Get-PantheonOpenAICredentialPath
  Set-PantheonCredentialAcl -CredentialRoot $credentialRoot
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $profile = [ordered]@{
    version = 1
    storage = "windows-current-user-dpapi"
    windowsSid = $identity.User.Value
    openAiApiKeyProtected = Protect-PantheonCurrentUserSecret -Secret $ApiKey
    enableLiveModels = $EnableLiveModels
    enableLiveResearch = $EnableLiveResearch
    enableImageGeneration = $EnableImageGeneration
    configuredAt = [DateTime]::UtcNow.ToString("o")
  }

  $temporaryPath = "$credentialPath.$PID.$([guid]::NewGuid().ToString('N')).tmp"
  $utf8 = New-Object Text.UTF8Encoding($false)
  try {
    [IO.File]::WriteAllText($temporaryPath, ($profile | ConvertTo-Json -Depth 6), $utf8)
    Move-Item -LiteralPath $temporaryPath -Destination $credentialPath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
  return $credentialPath
}

function Read-PantheonOpenAICredential {
  $credentialPath = Get-PantheonOpenAICredentialPath
  if (-not (Test-Path -LiteralPath $credentialPath)) { return $null }

  $profile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
  if ([string]$profile.storage -ne "windows-current-user-dpapi") {
    throw "Pantheon's OpenAI credential uses an unsupported storage format."
  }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not [string]::Equals([string]$profile.windowsSid, $currentSid, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Pantheon's OpenAI credential belongs to a different Windows account."
  }
  if ([string]::IsNullOrWhiteSpace([string]$profile.openAiApiKeyProtected)) {
    throw "Pantheon's OpenAI credential does not contain a protected API key."
  }

  return [pscustomobject]@{
    apiKey = Unprotect-PantheonCurrentUserSecret -ProtectedValue ([string]$profile.openAiApiKeyProtected)
    enableLiveModels = $profile.enableLiveModels -eq $true
    enableLiveResearch = $profile.enableLiveResearch -eq $true
    enableImageGeneration = $profile.enableImageGeneration -eq $true
    configuredAt = [string]$profile.configuredAt
    path = $credentialPath
  }
}
