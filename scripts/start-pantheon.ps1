[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5051,
  [switch]$NoOpen,
  [switch]$SystemProof,
  [switch]$JourneyRehearsal,
  [string]$OperatorUrlFile,
  [ValidateRange(2, 120)]
  [int]$StartupTimeoutSeconds = 30,
  [ValidateRange(2, 180)]
  [int]$ReadyTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
if ($JourneyRehearsal -and -not $PSBoundParameters.ContainsKey("Port")) {
  $Port = 5052
}
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")
$tmpRoot = Get-PantheonStateRoot -Root $root
$runtimePath = Get-PantheonRuntimePath -StateRoot $tmpRoot -Port $Port
$legacyRuntimePath = Join-Path $tmpRoot "jarvis-server-$Port.json"
$stdoutPath = Join-Path $tmpRoot "pantheon-server-$Port.log"
$stderrPath = Join-Path $tmpRoot "pantheon-server-$Port-error.log"
$dashboardUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/api/health"
$legacyCredentialPath = Join-Path $root "private\runtime-credentials.json"

function New-UrlToken {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) }
  finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Protect-LocalValue([string]$Value) {
  return ConvertFrom-SecureString (ConvertTo-SecureString $Value -AsPlainText -Force)
}

function Unprotect-LocalValue([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-EnvironmentValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
  }
  return $value
}

function Get-RuntimeEnvironmentValue([string]$Name) {
  $value = Get-EnvironmentValue $Name
  if ([string]::IsNullOrWhiteSpace($value) -and $Name.StartsWith("PANTHEON_")) {
    $value = Get-EnvironmentValue ($Name.Replace("PANTHEON_", "JARVIS_"))
  }
  return $value
}

function Set-RuntimeEnvironmentValue([hashtable]$Target, [string]$Name, [string]$Value) {
  $Target[$Name] = $Value
  if ($Name.StartsWith("PANTHEON_")) {
    $Target[$Name.Replace("PANTHEON_", "JARVIS_")] = $Value
  }
}

$runtimeNames = @(
  "OPENAI_API_KEY",
  "OPENAI_RESPONSES_URL",
  "PANTHEON_ENABLE_LIVE_MODELS",
  "PANTHEON_ENABLE_LIVE_RESEARCH",
  "PANTHEON_ENABLE_IMAGE_GENERATION",
  "PANTHEON_LIVE_MODEL",
  "PANTHEON_LUNA_MODEL",
  "PANTHEON_TERRA_MODEL",
  "PANTHEON_SOL_MODEL",
  "PANTHEON_SYSTEM_PROOF_MODE",
  "PANTHEON_JOURNEY_MODE",
  "PANTHEON_JOURNEY_BUDGET_CAP_AUD",
  "PANTHEON_LIVE_RESEARCH_MODEL",
  "PANTHEON_LIVE_MODEL_PROVIDER",
  "PANTHEON_LIVE_RESEARCH_PROVIDER",
  "PANTHEON_API_CREDIT_AUD_PER_USD",
  "PANTHEON_MONTHLY_BUDGET_AUD",
  "PANTHEON_LIVE_MODEL_BUDGET_AUD",
  "PANTHEON_LIVE_RESEARCH_BUDGET_AUD",
  "PANTHEON_LIVE_MODEL_TOOL_MAX_INPUT_TOKENS",
  "PANTHEON_LIVE_RESEARCH_MAX_INPUT_TOKENS",
  "PANTHEON_LIVE_MODEL_MAX_OUTPUT_TOKENS",
  "PANTHEON_LIVE_RESEARCH_MAX_OUTPUT_TOKENS",
  "PANTHEON_OPERATOR_EMAIL",
  "PANTHEON_PRIVACY_HASH_KEY",
  "PANTHEON_CURRENCY",
  "PANTHEON_DB_PATH",
  "PANTHEON_DATA_DIR",
  "PANTHEON_ARTIFACT_ROOT",
  "PANTHEON_PROOF_LEDGER_PATH",
  "PANTHEON_BACKUP_DESTINATION",
  "PANTHEON_BACKUP_PASSPHRASE",
  "PANTHEON_SCHEDULER_ENABLED",
  "PANTHEON_SCHEDULER_POLL_SECONDS",
  "PANTHEON_SCHEDULER_MAX_JOBS_PER_TICK",
  "PANTHEON_STANDBY_URL",
  "PANTHEON_STANDBY_HANDOFF_TOKEN"
)

$runtimeEnvironment = @{}
foreach ($name in $runtimeNames) {
  $value = Get-RuntimeEnvironmentValue $name
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    Set-RuntimeEnvironmentValue $runtimeEnvironment $name $value
  }
}
if ($SystemProof) {
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_SYSTEM_PROOF_MODE" "1"
}

$openAiCredentialError = $null
try {
  $openAiCredential = Read-PantheonOpenAICredential
  if ($openAiCredential) {
    # Pantheon's Windows-user-protected store is authoritative when present.
    # Environment values remain a fallback for development and migration.
    $runtimeEnvironment["OPENAI_API_KEY"] = [string]$openAiCredential.apiKey
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_LIVE_MODELS") -and $openAiCredential.enableLiveModels) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_LIVE_MODELS" "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_LIVE_RESEARCH") -and $openAiCredential.enableLiveResearch) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_LIVE_RESEARCH" "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_IMAGE_GENERATION") -and $openAiCredential.enableImageGeneration) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_IMAGE_GENERATION" "1"
    }
  }
} catch {
  $openAiCredentialError = $_.Exception.Message
}

$recoveryCredentialError = $null
try {
  $recoveryCredential = Read-PantheonRecoveryCredential
  if ($recoveryCredential) {
    $environmentBackupPassphrase = if ($runtimeEnvironment.ContainsKey("PANTHEON_BACKUP_PASSPHRASE")) {
      [string]$runtimeEnvironment["PANTHEON_BACKUP_PASSPHRASE"]
    } else {
      ""
    }
    if (
      -not [string]::IsNullOrWhiteSpace($environmentBackupPassphrase) -and
      -not [string]::Equals(
        (Get-PantheonBackupKeyId -Passphrase $environmentBackupPassphrase),
        [string]$recoveryCredential.activeKeyId,
        [StringComparison]::OrdinalIgnoreCase
      )
    ) {
      $environmentKeyId = Get-PantheonBackupKeyId -Passphrase $environmentBackupPassphrase
      $knownLegacyKey = @($recoveryCredential.legacyBackupKeys) | Where-Object {
        [string]::Equals([string]$_.keyId, $environmentKeyId, [StringComparison]::OrdinalIgnoreCase)
      } | Select-Object -First 1
      if (-not $knownLegacyKey) {
        throw "A user environment backup key conflicts with Pantheon's protected recovery profile. Remove the old PANTHEON_BACKUP_PASSPHRASE or JARVIS_BACKUP_PASSPHRASE value."
      }
    }
    Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_BACKUP_PASSPHRASE" ([string]$recoveryCredential.backupPassphrase)
    if (-not [string]::IsNullOrWhiteSpace([string]$recoveryCredential.privacyHashKey)) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_PRIVACY_HASH_KEY" ([string]$recoveryCredential.privacyHashKey)
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$recoveryCredential.backupDestination)) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_BACKUP_DESTINATION" ([string]$recoveryCredential.backupDestination)
    }
  }
} catch {
  $recoveryCredentialError = $_.Exception.Message
}

$legacyCredentialAvailable = $false
try {
  $legacyCredentialAvailable = Test-Path -LiteralPath $legacyCredentialPath
} catch {
  Write-Warning "Pantheon could not inspect its legacy recovery profile. Current protected credential stores will be used."
}
if ($legacyCredentialAvailable) {
  try {
    $credentialProfile = Get-Content -LiteralPath $legacyCredentialPath -Raw | ConvertFrom-Json
    if (-not $runtimeEnvironment.ContainsKey("OPENAI_API_KEY") -and -not [string]::IsNullOrWhiteSpace([string]$credentialProfile.openAiApiKeyProtected)) {
      try {
        $runtimeEnvironment["OPENAI_API_KEY"] = Unprotect-LocalValue ([string]$credentialProfile.openAiApiKeyProtected)
      } catch {
        if ([string]::IsNullOrWhiteSpace($openAiCredentialError)) { $openAiCredentialError = $_.Exception.Message }
      }
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_LIVE_MODELS") -and $credentialProfile.enableLiveModels -eq $true) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_LIVE_MODELS" "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_LIVE_RESEARCH") -and $credentialProfile.enableLiveResearch -eq $true) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_LIVE_RESEARCH" "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_ENABLE_IMAGE_GENERATION") -and (
      $credentialProfile.enableImageGeneration -eq $true -or
      ($null -eq $credentialProfile.enableImageGeneration -and $credentialProfile.enableLiveModels -eq $true)
    )) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ENABLE_IMAGE_GENERATION" "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_BACKUP_PASSPHRASE") -and -not [string]::IsNullOrWhiteSpace([string]$credentialProfile.backupPassphraseProtected)) {
      try {
        Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_BACKUP_PASSPHRASE" (Unprotect-LocalValue ([string]$credentialProfile.backupPassphraseProtected))
      } catch {
        Write-Warning "Pantheon could not unlock the legacy backup passphrase. OpenAI startup will continue independently."
      }
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_PRIVACY_HASH_KEY") -and -not [string]::IsNullOrWhiteSpace([string]$credentialProfile.privacyHashKeyProtected)) {
      try {
        Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_PRIVACY_HASH_KEY" (Unprotect-LocalValue ([string]$credentialProfile.privacyHashKeyProtected))
      } catch {
        Write-Warning "Pantheon could not unlock the legacy privacy key. OpenAI startup will continue independently."
      }
    }
    if (-not $runtimeEnvironment.ContainsKey("PANTHEON_BACKUP_DESTINATION") -and -not [string]::IsNullOrWhiteSpace([string]$credentialProfile.backupDestination)) {
      Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_BACKUP_DESTINATION" ([string]$credentialProfile.backupDestination)
    }
  } catch {
    Write-Warning "Pantheon could not read its legacy recovery profile. OpenAI startup will continue independently."
  }
}

if (-not $runtimeEnvironment.ContainsKey("OPENAI_API_KEY") -and -not [string]::IsNullOrWhiteSpace($openAiCredentialError)) {
  throw "Pantheon could not unlock its protected OpenAI credential. Run Connect OpenAI once from this Windows account."
}
if (-not [string]::IsNullOrWhiteSpace($recoveryCredentialError)) {
  throw "Pantheon could not load its protected recovery profile. $recoveryCredentialError"
}

if ($JourneyRehearsal) {
  $rehearsalData = Join-Path $root "data\journey-rehearsal"
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_JOURNEY_MODE" "rehearsal"
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_DATA_DIR" $rehearsalData
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_DB_PATH" (Join-Path $rehearsalData "runtime.sqlite")
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_ARTIFACT_ROOT" (Join-Path $rehearsalData "artifacts")
  Set-RuntimeEnvironmentValue $runtimeEnvironment "PANTHEON_SCHEDULER_ENABLED" "0"
}

$expectedDbPath = if ($runtimeEnvironment.ContainsKey("PANTHEON_DB_PATH")) {
  [IO.Path]::GetFullPath($runtimeEnvironment["PANTHEON_DB_PATH"])
} elseif ($runtimeEnvironment.ContainsKey("PANTHEON_DATA_DIR")) {
  [IO.Path]::GetFullPath((Join-Path $runtimeEnvironment["PANTHEON_DATA_DIR"] "runtime.sqlite"))
} else {
  [IO.Path]::GetFullPath((Join-Path $root "data\runtime.sqlite"))
}

$runtimeSourceFiles = @(
  Get-ChildItem -LiteralPath (Join-Path $root "src") -File -Recurse
  Get-ChildItem -LiteralPath (Join-Path $root "public") -File -Recurse
  Get-Item -LiteralPath (Join-Path $root "scripts\serve-pantheon.js")
  Get-Item -LiteralPath (Join-Path $root "package.json")
  Get-Item -LiteralPath (Join-Path $root "package-lock.json")
) | Sort-Object FullName
$runtimeSourceFingerprintText = ($runtimeSourceFiles | ForEach-Object {
  $trimmedRoot = $root.TrimEnd([char[]]@('\', '/'))
  $relativePath = $_.FullName.Substring($trimmedRoot.Length).TrimStart([char[]]@('\', '/')).Replace("\", "/")
  "$relativePath=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
}) -join "`n"
$runtimeSourceBytes = [Text.Encoding]::UTF8.GetBytes($runtimeSourceFingerprintText)
$runtimeSourceSha256 = [Security.Cryptography.SHA256]::Create()
try {
  $runtimeSourceFingerprint = ([BitConverter]::ToString(
    $runtimeSourceSha256.ComputeHash($runtimeSourceBytes)
  )).Replace("-", "").ToLowerInvariant()
} finally {
  $runtimeSourceSha256.Dispose()
}

$fingerprintText = ($runtimeNames | ForEach-Object {
  $value = $runtimeEnvironment[$_]
  if ($null -eq $value) { $value = "" }
  "$_=$value"
}) -join "`n"
$fingerprintText = "$fingerprintText`nPANTHEON_RUNTIME_SOURCE=$runtimeSourceFingerprint"
$fingerprintBytes = [Text.Encoding]::UTF8.GetBytes($fingerprintText)
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha256.ComputeHash($fingerprintBytes))).Replace("-", "").ToLowerInvariant() }
finally { $sha256.Dispose() }

New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$launcherLock = Enter-PantheonLauncherLock -StateRoot $tmpRoot -Port $Port
try {
if (-not (Test-Path -LiteralPath $runtimePath) -and (Test-Path -LiteralPath $legacyRuntimePath)) {
  Move-Item -LiteralPath $legacyRuntimePath -Destination $runtimePath
}
$metadata = Read-PantheonMetadata -Path $runtimePath
if ($metadata -and ($metadata.PSObject.Properties.Name -contains "invalid") -and $metadata.invalid -eq $true) {
  $unreadableHealth = Get-PantheonHealth -Port $Port
  if ($unreadableHealth -or -not (Test-PantheonPortAvailable -Port $Port)) {
    throw "Pantheon found unreadable ownership data while port $Port is active. It did not start or take control of that process."
  }
  Remove-Item -LiteralPath $runtimePath -Force
  Write-Warning "Pantheon removed an unreadable stale ownership file after confirming that no process was using port $Port."
  $metadata = $null
}

$health = Get-PantheonHealth -Port $Port
if ($health -and (-not $metadata -or [string]$metadata.instanceId -ne [string]$health.instanceId)) {
  throw "Port $Port is already serving a different local process. Pantheon did not take control of it."
}
if ($health -and $metadata) {
  $liveOwnership = Test-PantheonProcessOwnership -Metadata $metadata -Port $Port -Health $health
  if (-not $liveOwnership.owned) {
    throw "Pantheon found live service ownership that does not match its exact recorded Windows process ($($liveOwnership.reason)). It did not start or stop anything."
  }
}

if ($health -and $metadata -and [string]$metadata.configFingerprint -ne $fingerprint) {
  Write-Host "Refreshing Pantheon with the current approved connections and limits..."
  & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld
  if (-not $?) { throw "The existing Pantheon process could not be refreshed safely." }
  $health = $null
  $metadata = $null
}

if (-not $health) {
  if ($metadata) {
    $staleOwnership = Test-PantheonProcessOwnership -Metadata $metadata -Port $Port
    if ($staleOwnership.owned) {
      Write-Host "Recovering a launcher-owned Pantheon process whose health endpoint is unavailable..."
      & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld
      if (-not $?) { throw "The existing Pantheon process could not be recovered safely." }
    } elseif ($staleOwnership.reason -eq "process_identity_changed" -and (Test-PantheonPortAvailable -Port $Port)) {
      Remove-Item -LiteralPath $runtimePath -Force
      Write-Warning "Pantheon removed a stale launcher record after Windows reused its old process ID. The unrelated live process was not touched."
    } elseif ($staleOwnership.reason -ne "process_not_running") {
      throw "Pantheon found ownership data for a different live Windows process ($($staleOwnership.reason)). It did not stop that process."
    } else {
      Remove-Item -LiteralPath $runtimePath -Force
    }
    $metadata = $null
  }

  if (-not (Test-PantheonPortAvailable -Port $Port)) {
    throw "Port $Port is already in use by a process Pantheon does not own. Nothing was started or stopped."
  }

  $node = Get-Command node.exe -ErrorAction Stop
  $nodeMajor = [int]((& $node.Source -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
  if ($nodeMajor -ne 24) {
    throw "Pantheon is verified for Node.js 24. Found Node.js $nodeMajor."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    throw "Pantheon setup is incomplete because its locked dependencies are not installed. Ask Jarvis to run the one-time setup; normal startup will not install software or wait on the network."
  }

  $bootstrapToken = New-UrlToken
  $controlToken = New-UrlToken
  $instanceId = [guid]::NewGuid().ToString()
  [IO.File]::WriteAllText($stdoutPath, "")
  [IO.File]::WriteAllText($stderrPath, "")

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $serverScriptPath = [IO.Path]::GetFullPath((Join-Path $root "scripts\serve-pantheon.js"))
  $startInfo.FileName = $node.Source
  $startInfo.Arguments = "`"$serverScriptPath`" $Port"
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  # Windows PowerShell 5.1 lazily initializes this collection and can return
  # null on its first getter call. Touch the legacy alias before using it.
  $null = $startInfo.EnvironmentVariables
  $processEnvironment = $startInfo.Environment
  if ($null -eq $processEnvironment) {
    throw "Windows could not prepare Pantheon's isolated process environment."
  }
  $processEnvironment.Clear()

  foreach ($name in @("Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "OneDrive", "ComSpec")) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($value)) { $processEnvironment[$name] = $value }
  }
  foreach ($name in $runtimeEnvironment.Keys) { $processEnvironment[$name] = $runtimeEnvironment[$name] }
  $processEnvironment["NODE_ENV"] = "production"
  $processEnvironment["PORT"] = [string]$Port
  foreach ($prefix in @("PANTHEON", "JARVIS")) {
    $processEnvironment["${prefix}_LIVE_MODE"] = "0"
    $processEnvironment["${prefix}_OPERATOR_BOOTSTRAP"] = $bootstrapToken
    $processEnvironment["${prefix}_CONTROL_TOKEN"] = $controlToken
    $processEnvironment["${prefix}_RUNTIME_INSTANCE_ID"] = $instanceId
  }

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Pantheon server process could not be started." }
  $processSnapshotDeadline = [DateTime]::UtcNow.AddMilliseconds(2000)
  $processSnapshot = $null
  do {
    $process.Refresh()
    if ($process.HasExited) { break }
    $processSnapshot = Get-PantheonProcessSnapshot -ProcessId $process.Id
    if ($processSnapshot) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $processSnapshotDeadline)
  if (-not $processSnapshot) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Pantheon could not record the exact identity of its new Windows process. The process was stopped."
  }

  $metadata = [ordered]@{
    metadataVersion = 2
    pid = $process.Id
    port = $Port
    instanceId = $instanceId
    mode = $(if ($JourneyRehearsal) { "rehearsal" } else { "production" })
    ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    executablePath = [string]$processSnapshot.executablePath
    processStartFileTimeUtc = [string]$processSnapshot.startFileTimeUtc
    processStartTimeUtc = [string]$processSnapshot.startTimeUtc
    serverScriptPath = $serverScriptPath
    workspaceRoot = [IO.Path]::GetFullPath($root)
    expectedDbPath = $expectedDbPath
    configFingerprint = $fingerprint
    bootstrapProtected = Protect-LocalValue $bootstrapToken
    controlProtected = Protect-LocalValue $controlToken
    startedAt = [string]$processSnapshot.startTimeUtc
  }
  Write-PantheonMetadata -Path $runtimePath -Metadata $metadata

  $startupDeadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $health = Get-PantheonHealth -Port $Port
    if ($health -and [string]$health.instanceId -eq $instanceId) { break }
    if ($process.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $startupDeadline)

  if (-not $health -or [string]$health.instanceId -ne $instanceId) {
    try { & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld -GracefulTimeoutSeconds 2 }
    catch { Write-Warning "Pantheon also encountered a safe-cleanup problem: $($_.Exception.Message)" }
    throw "Pantheon did not become ready. See $stderrPath for the startup error."
  }
} else {
  $bootstrapToken = Unprotect-LocalValue ([string]$metadata.bootstrapProtected)
}

$readyDeadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
while ($health.ok -ne $true -and [DateTime]::UtcNow -lt $readyDeadline) {
  if ($health.scheduler.enabled -eq $false -or $health.monitoring.job.enabled -eq $false) { break }
  Start-Sleep -Milliseconds 500
  $refreshedHealth = Get-PantheonHealth -Port $Port
  if ($refreshedHealth -and [string]$refreshedHealth.instanceId -eq [string]$health.instanceId) {
    $health = $refreshedHealth
  }
}

if ($health.ok -ne $true -and -not $JourneyRehearsal) {
  $notReadyReason = [string]$health.monitoring.reason
  try { & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld -GracefulTimeoutSeconds 4 }
  catch { throw "Pantheon was not operations-ready ($notReadyReason), and its partial startup could not be cleaned up safely: $($_.Exception.Message)" }
  throw "Pantheon was reachable but not operations-ready ($notReadyReason). It was stopped cleanly; see $stderrPath before trying again."
}

$operatorUrl = "$dashboardUrl#bootstrap=$bootstrapToken"
if (-not [string]::IsNullOrWhiteSpace($OperatorUrlFile)) {
  $handoffPath = [IO.Path]::GetFullPath($OperatorUrlFile)
  $allowedRoot = [IO.Path]::GetFullPath($tmpRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  if (-not $handoffPath.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Pantheon refused to write an operator handoff outside its local temporary state directory."
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $handoffPath) -Force | Out-Null
  [IO.File]::WriteAllText($handoffPath, $operatorUrl, (New-Object Text.UTF8Encoding($false)))
}
if (-not $NoOpen) {
  Start-Process $operatorUrl
}

if ($health.ok -eq $true) {
  Write-Host "Pantheon is ready at $dashboardUrl"
  Write-Host "Windows process: $($metadata.pid); mode: $($metadata.mode)."
  Write-Host "Independent monitoring: ready; latest check $($health.monitoring.latestCompletedCheck.completedAt)."
  Write-Host "Outside business actions: $($health.externalActionsMode). Paid AI: $(if ($health.paidAiArmed) { 'available behind exact approval' } else { 'setup needed' })."
  return
}

if ($JourneyRehearsal -and $health.alive -eq $true) {
  Write-Host "Pantheon's isolated rehearsal is ready at $dashboardUrl"
  Write-Host "Windows process: $($metadata.pid); unattended scheduling is intentionally disabled for this rehearsal."
  return
}

Write-Warning "Pantheon is alive at $dashboardUrl, but operations are not ready."
switch ([string]$health.monitoring.reason) {
  "scheduler_disabled" {
    Write-Warning "Independent monitoring is disabled by PANTHEON_SCHEDULER_ENABLED=0. Enable it and restart Pantheon before relying on unattended operation."
  }
  "scheduler_not_running" {
    Write-Warning "The scheduler did not start. Check $stderrPath before relying on unattended operation."
  }
  "monitor_job_disabled" {
    Write-Warning "The runtime monitor job is disabled. Enable Runtime monitor cycle in System, then restart Pantheon."
  }
  "monitor_job_failed" {
    Write-Warning "The latest scheduled monitor run failed. Check System activity and $stderrPath."
  }
  "monitor_check_overdue" {
    Write-Warning "The latest completed monitor check is overdue. Last check: $($health.monitoring.latestCompletedCheck.completedAt)."
  }
  default {
    Write-Warning "Pantheon did not complete its startup monitor check. Monitoring state: $($health.monitoring.reason). Check $stderrPath."
  }
}
Write-Host "Outside business actions: $($health.externalActionsMode). Paid AI: $(if ($health.paidAiArmed) { 'available behind exact approval' } else { 'setup needed' })."
} finally {
  if ($launcherLock) { $launcherLock.Dispose() }
}
