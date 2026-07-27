[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5050,
  [ValidateRange(1, 65535)]
  [int]$WorkingPort = 5051,
  [switch]$NoOpen,
  [switch]$LifecycleProof,
  [ValidateRange(2, 60)]
  [int]$StartupTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
$stateRoot = Get-PantheonStateRoot -Root $root
$runtimePath = Get-PantheonRuntimePath -StateRoot $stateRoot -Port $Port
$stdoutPath = Join-Path $stateRoot "pantheon-server-$Port.log"
$stderrPath = Join-Path $stateRoot "pantheon-server-$Port-error.log"
$dashboardUrl = "http://127.0.0.1:$Port/"

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

New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$launcherLock = Enter-PantheonLauncherLock -StateRoot $stateRoot -Port $Port
try {
  $metadata = Read-PantheonMetadata -Path $runtimePath
  $health = Get-PantheonHealth -Port $Port
  if ($health -and $metadata) {
    $ownership = Test-PantheonProcessOwnership -Metadata $metadata -Port $Port -Health $health
    if (-not $ownership.owned) {
      throw "Pantheon Control found a live process whose Windows identity does not match its ownership record."
    }
    $bootstrapToken = Unprotect-LocalValue ([string]$metadata.bootstrapProtected)
  } else {
    if ($metadata) {
      $ownership = Test-PantheonProcessOwnership -Metadata $metadata -Port $Port
      if ($ownership.owned) {
        & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld
      } elseif ($ownership.reason -eq "process_identity_changed" -and (Test-PantheonPortAvailable -Port $Port)) {
        Remove-Item -LiteralPath $runtimePath -Force
      } elseif ($ownership.reason -eq "process_not_running") {
        Remove-Item -LiteralPath $runtimePath -Force
      } else {
        throw "Pantheon Control found unsafe stale ownership data ($($ownership.reason))."
      }
    }
    if (-not (Test-PantheonPortAvailable -Port $Port)) {
      throw "Pantheon Control port $Port is occupied by an unknown process."
    }

    $node = Get-Command node.exe -ErrorAction Stop
    $nodeMajor = [int]((& $node.Source -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
    if ($nodeMajor -ne 24) {
      throw "Pantheon Control is verified for Node.js 24. Found Node.js $nodeMajor."
    }

    $bootstrapToken = New-UrlToken
    $controlToken = New-UrlToken
    $instanceId = [guid]::NewGuid().ToString()
    [IO.File]::WriteAllText($stdoutPath, "")
    [IO.File]::WriteAllText($stderrPath, "")

    $scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "pantheon-standby.js"))
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $node.Source
    $startInfo.Arguments = "`"$scriptPath`" $Port"
    $startInfo.WorkingDirectory = $root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $null = $startInfo.EnvironmentVariables
    $environment = $startInfo.Environment
    $environment.Clear()
    foreach ($name in @("Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec")) {
      $value = [Environment]::GetEnvironmentVariable($name, "Process")
      if (-not [string]::IsNullOrWhiteSpace($value)) { $environment[$name] = $value }
    }
    $environment["NODE_ENV"] = "production"
    $environment["PORT"] = [string]$Port
    $environment["PANTHEON_OPERATOR_BOOTSTRAP"] = $bootstrapToken
    $environment["PANTHEON_CONTROL_TOKEN"] = $controlToken
    $environment["PANTHEON_RUNTIME_INSTANCE_ID"] = $instanceId
    $environment["PANTHEON_RUNTIME_METADATA_PATH"] = $runtimePath
    $environment["PANTHEON_WORKING_PORT"] = [string]$WorkingPort
    if ($LifecycleProof) {
      $environment["PANTHEON_CONTROL_JOURNEY_REHEARSAL"] = "1"
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Pantheon Control could not start." }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    $snapshot = Get-PantheonProcessSnapshot -ProcessId $process.Id
    if (-not $snapshot) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Pantheon Control could not record its exact Windows identity."
    }
    $metadata = [ordered]@{
      metadataVersion = 2
      pid = $process.Id
      port = $Port
      instanceId = $instanceId
      mode = "standby"
      ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      executablePath = [string]$snapshot.executablePath
      processStartFileTimeUtc = [string]$snapshot.startFileTimeUtc
      processStartTimeUtc = [string]$snapshot.startTimeUtc
      serverScriptPath = $scriptPath
      workspaceRoot = [IO.Path]::GetFullPath($root)
      expectedDbPath = $null
      configFingerprint = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
      bootstrapProtected = Protect-LocalValue $bootstrapToken
      controlProtected = Protect-LocalValue $controlToken
      startedAt = [string]$snapshot.startTimeUtc
    }
    Write-PantheonMetadata -Path $runtimePath -Metadata $metadata

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
      Start-Sleep -Milliseconds 250
      $health = Get-PantheonHealth -Port $Port
      if ($health -and [string]$health.instanceId -eq $instanceId) { break }
      if ($process.HasExited) { break }
    } while ([DateTime]::UtcNow -lt $deadline)

    if (-not $health -or [string]$health.instanceId -ne $instanceId) {
      try { & (Join-Path $PSScriptRoot "stop-pantheon.ps1") -Port $Port -LauncherLockHeld }
      catch { Write-Warning $_.Exception.Message }
      throw "Pantheon Control did not become available."
    }
  }

  $operatorUrl = "$dashboardUrl#bootstrap=$bootstrapToken"
  if (-not $NoOpen) {
    Start-Process $operatorUrl
  }
  Write-Host "Pantheon Control is ready in standby at $dashboardUrl"
  Write-Host "Use Start working in the control screen when you want the business runtime active."
} finally {
  if ($launcherLock) { $launcherLock.Dispose() }
}
