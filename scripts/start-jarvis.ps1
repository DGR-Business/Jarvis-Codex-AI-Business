[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5051,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tmpRoot = Join-Path $root "tmp"
$runtimePath = Join-Path $tmpRoot "jarvis-server-$Port.json"
$stdoutPath = Join-Path $tmpRoot "jarvis-server-$Port.log"
$stderrPath = Join-Path $tmpRoot "jarvis-server-$Port-error.log"
$dashboardUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/api/health"
$credentialPath = Join-Path $root "private\runtime-credentials.json"

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

$runtimeNames = @(
  "OPENAI_API_KEY",
  "OPENAI_RESPONSES_URL",
  "JARVIS_ENABLE_LIVE_MODELS",
  "JARVIS_ENABLE_LIVE_RESEARCH",
  "JARVIS_ENABLE_IMAGE_GENERATION",
  "JARVIS_LIVE_MODEL",
  "JARVIS_LUNA_MODEL",
  "JARVIS_TERRA_MODEL",
  "JARVIS_SOL_MODEL",
  "JARVIS_LIVE_RESEARCH_MODEL",
  "JARVIS_LIVE_MODEL_PROVIDER",
  "JARVIS_LIVE_RESEARCH_PROVIDER",
  "JARVIS_API_CREDIT_AUD_PER_USD",
  "JARVIS_MONTHLY_BUDGET_AUD",
  "JARVIS_LIVE_MODEL_BUDGET_AUD",
  "JARVIS_LIVE_RESEARCH_BUDGET_AUD",
  "JARVIS_LIVE_MODEL_TOOL_MAX_INPUT_TOKENS",
  "JARVIS_LIVE_RESEARCH_MAX_INPUT_TOKENS",
  "JARVIS_LIVE_MODEL_MAX_OUTPUT_TOKENS",
  "JARVIS_LIVE_RESEARCH_MAX_OUTPUT_TOKENS",
  "JARVIS_OPERATOR_EMAIL",
  "JARVIS_PRIVACY_HASH_KEY",
  "JARVIS_CURRENCY",
  "JARVIS_DB_PATH",
  "JARVIS_DATA_DIR",
  "JARVIS_ARTIFACT_ROOT",
  "JARVIS_BACKUP_DESTINATION",
  "JARVIS_SCHEDULER_ENABLED",
  "JARVIS_SCHEDULER_POLL_SECONDS",
  "JARVIS_SCHEDULER_MAX_JOBS_PER_TICK"
)

$runtimeEnvironment = @{}
foreach ($name in $runtimeNames) {
  $value = Get-EnvironmentValue $name
  if (-not [string]::IsNullOrWhiteSpace($value)) { $runtimeEnvironment[$name] = $value }
}

if (Test-Path -LiteralPath $credentialPath) {
  try {
    $credentialProfile = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
    if (-not $runtimeEnvironment.ContainsKey("OPENAI_API_KEY") -and -not [string]::IsNullOrWhiteSpace([string]$credentialProfile.openAiApiKeyProtected)) {
      $runtimeEnvironment["OPENAI_API_KEY"] = Unprotect-LocalValue ([string]$credentialProfile.openAiApiKeyProtected)
    }
    if (-not $runtimeEnvironment.ContainsKey("JARVIS_ENABLE_LIVE_MODELS") -and $credentialProfile.enableLiveModels -eq $true) {
      $runtimeEnvironment["JARVIS_ENABLE_LIVE_MODELS"] = "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("JARVIS_ENABLE_LIVE_RESEARCH") -and $credentialProfile.enableLiveResearch -eq $true) {
      $runtimeEnvironment["JARVIS_ENABLE_LIVE_RESEARCH"] = "1"
    }
    if (-not $runtimeEnvironment.ContainsKey("JARVIS_ENABLE_IMAGE_GENERATION") -and (
      $credentialProfile.enableImageGeneration -eq $true -or
      ($null -eq $credentialProfile.enableImageGeneration -and $credentialProfile.enableLiveModels -eq $true)
    )) {
      $runtimeEnvironment["JARVIS_ENABLE_IMAGE_GENERATION"] = "1"
    }
  } catch {
    throw "Jarvis could not unlock its local OpenAI credential profile. Re-run Connect OpenAI for this Windows account."
  }
}

$expectedDbPath = if ($runtimeEnvironment.ContainsKey("JARVIS_DB_PATH")) {
  [IO.Path]::GetFullPath($runtimeEnvironment["JARVIS_DB_PATH"])
} elseif ($runtimeEnvironment.ContainsKey("JARVIS_DATA_DIR")) {
  [IO.Path]::GetFullPath((Join-Path $runtimeEnvironment["JARVIS_DATA_DIR"] "runtime.sqlite"))
} else {
  [IO.Path]::GetFullPath((Join-Path $root "data\runtime.sqlite"))
}

$fingerprintText = ($runtimeNames | ForEach-Object {
  $value = $runtimeEnvironment[$_]
  if ($null -eq $value) { $value = "" }
  "$_=$value"
}) -join "`n"
$fingerprintBytes = [Text.Encoding]::UTF8.GetBytes($fingerprintText)
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha256.ComputeHash($fingerprintBytes))).Replace("-", "").ToLowerInvariant() }
finally { $sha256.Dispose() }

function Get-JarvisHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.alive -ne $true -and $health.ok -ne $true) { return $null }
    return $health
  } catch {
    return $null
  }
}

New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$metadata = $null
if (Test-Path -LiteralPath $runtimePath) {
  try { $metadata = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json }
  catch { throw "Jarvis found an unreadable runtime ownership file at $runtimePath." }
}

$health = Get-JarvisHealth
if ($health -and (-not $metadata -or [string]$metadata.instanceId -ne [string]$health.instanceId)) {
  throw "Port $Port is already serving a different local process. Jarvis did not take control of it."
}

if ($health -and $metadata -and [string]$metadata.configFingerprint -ne $fingerprint) {
  Write-Host "Refreshing Jarvis with the current approved connections and limits..."
  & (Join-Path $PSScriptRoot "stop-jarvis.ps1") -Port $Port
  if (-not $?) { throw "The existing Jarvis process could not be refreshed safely." }
  $health = $null
  $metadata = $null
}

if (-not $health) {
  if ($metadata) {
    $staleProcess = Get-Process -Id ([int]$metadata.pid) -ErrorAction SilentlyContinue
    if ($staleProcess) {
      throw "Jarvis found a stale ownership file for a still-running process. Stop it safely before restarting."
    }
    Remove-Item -LiteralPath $runtimePath -Force
  }

  $node = Get-Command node.exe -ErrorAction Stop
  $nodeMajor = [int]((& $node.Source -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
  if ($nodeMajor -ne 24) {
    throw "Jarvis is verified for Node.js 24. Found Node.js $nodeMajor."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host "Preparing Jarvis for first use..."
    & $npm.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Jarvis dependencies could not be installed." }
  }

  $bootstrapToken = New-UrlToken
  $controlToken = New-UrlToken
  $instanceId = [guid]::NewGuid().ToString()
  [IO.File]::WriteAllText($stdoutPath, "")
  [IO.File]::WriteAllText($stderrPath, "")

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node.Source
  $startInfo.Arguments = "scripts/serve-jarvis.js $Port"
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.EnvironmentVariables.Clear()

  foreach ($name in @("Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "OneDrive", "ComSpec")) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($value)) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  foreach ($name in $runtimeEnvironment.Keys) { $startInfo.EnvironmentVariables[$name] = $runtimeEnvironment[$name] }
  $startInfo.EnvironmentVariables["NODE_ENV"] = "production"
  $startInfo.EnvironmentVariables["PORT"] = [string]$Port
  $startInfo.EnvironmentVariables["JARVIS_LIVE_MODE"] = "0"
  $startInfo.EnvironmentVariables["JARVIS_OPERATOR_BOOTSTRAP"] = $bootstrapToken
  $startInfo.EnvironmentVariables["JARVIS_CONTROL_TOKEN"] = $controlToken
  $startInfo.EnvironmentVariables["JARVIS_RUNTIME_INSTANCE_ID"] = $instanceId

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Jarvis server process could not be started." }

  $metadata = [ordered]@{
    pid = $process.Id
    port = $Port
    instanceId = $instanceId
    expectedDbPath = $expectedDbPath
    configFingerprint = $fingerprint
    bootstrapProtected = Protect-LocalValue $bootstrapToken
    controlProtected = Protect-LocalValue $controlToken
    startedAt = [DateTime]::UtcNow.ToString("o")
  }
  $metadata | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding utf8

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $health = Get-JarvisHealth
    if ($health -and [string]$health.instanceId -eq $instanceId) { break }
    if ($process.HasExited) { break }
  }

  if (-not $health -or [string]$health.instanceId -ne $instanceId) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
    throw "Jarvis did not become ready. See $stderrPath for the startup error."
  }
} else {
  $bootstrapToken = Unprotect-LocalValue ([string]$metadata.bootstrapProtected)
}

for ($attempt = 0; $attempt -lt 60 -and $health.ok -ne $true; $attempt += 1) {
  if ($health.scheduler.enabled -eq $false -or $health.monitoring.job.enabled -eq $false) { break }
  Start-Sleep -Milliseconds 500
  $refreshedHealth = Get-JarvisHealth
  if ($refreshedHealth -and [string]$refreshedHealth.instanceId -eq [string]$health.instanceId) {
    $health = $refreshedHealth
  }
}

$operatorUrl = "$dashboardUrl#bootstrap=$bootstrapToken"
if (-not $NoOpen) {
  Start-Process $operatorUrl
}

if ($health.ok -eq $true) {
  Write-Host "Jarvis is ready at $dashboardUrl"
  Write-Host "Independent monitoring: ready; latest check $($health.monitoring.latestCompletedCheck.completedAt)."
  Write-Host "Outside business actions: $($health.externalActionsMode). Paid AI: $(if ($health.paidAiArmed) { 'available behind exact approval' } else { 'setup needed' })."
  return
}

Write-Warning "Jarvis is alive at $dashboardUrl, but operations are not ready."
switch ([string]$health.monitoring.reason) {
  "scheduler_disabled" {
    Write-Warning "Independent monitoring is disabled by JARVIS_SCHEDULER_ENABLED=0. Enable it and restart Jarvis before relying on unattended operation."
  }
  "scheduler_not_running" {
    Write-Warning "The scheduler did not start. Check $stderrPath before relying on unattended operation."
  }
  "monitor_job_disabled" {
    Write-Warning "The runtime monitor job is disabled. Enable Runtime monitor cycle in System, then restart Jarvis."
  }
  "monitor_job_failed" {
    Write-Warning "The latest scheduled monitor run failed. Check System activity and $stderrPath."
  }
  "monitor_check_overdue" {
    Write-Warning "The latest completed monitor check is overdue. Last check: $($health.monitoring.latestCompletedCheck.completedAt)."
  }
  default {
    Write-Warning "Jarvis did not complete its startup monitor check. Monitoring state: $($health.monitoring.reason). Check $stderrPath."
  }
}
Write-Host "Outside business actions: $($health.externalActionsMode). Paid AI: $(if ($health.paidAiArmed) { 'available behind exact approval' } else { 'setup needed' })."
