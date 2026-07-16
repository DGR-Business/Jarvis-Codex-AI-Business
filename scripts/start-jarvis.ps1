[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5051,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tmpRoot = Join-Path $root "tmp"
$pidPath = Join-Path $tmpRoot "jarvis-server.pid"
$stdoutPath = Join-Path $tmpRoot "jarvis-server.log"
$stderrPath = Join-Path $tmpRoot "jarvis-server-error.log"
$expectedDbPath = [IO.Path]::GetFullPath((Join-Path $root "data\runtime.sqlite"))
$dashboardUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/api/health"

function Get-JarvisHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok -ne $true) { return $null }
    if ([IO.Path]::GetFullPath([string]$health.dbPath) -ne $expectedDbPath) { return $null }
    return $health
  } catch {
    return $null
  }
}

$health = Get-JarvisHealth
if (-not $health) {
  $node = Get-Command node.exe -ErrorAction Stop
  $nodeMajor = [int]((& $node.Source -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
  if ($nodeMajor -lt 24) {
    throw "Jarvis requires Node.js 24 or newer. Found Node.js $nodeMajor."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host "Preparing Jarvis for first use..."
    & $npm.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Jarvis dependencies could not be installed." }
  }

  New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
  [IO.File]::WriteAllText($stdoutPath, "")
  [IO.File]::WriteAllText($stderrPath, "")
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node.Source
  $startInfo.Arguments = "scripts/serve-jarvis.js $Port"
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Jarvis server process could not be started." }
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $health = Get-JarvisHealth
    if ($health) { break }
    if ($process.HasExited) { break }
  }

  if (-not $health) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    throw "Jarvis did not become ready. See $stderrPath for the startup error."
  }
}

if (-not $NoOpen) {
  Start-Process $dashboardUrl
}

Write-Host "Jarvis is ready at $dashboardUrl"
Write-Host "Mode: $($health.mode). AI workers and outside actions still require their normal approvals."
