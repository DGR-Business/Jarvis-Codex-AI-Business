[CmdletBinding()]
param(
  [string]$StateRoot
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")
if ([string]::IsNullOrWhiteSpace($StateRoot)) {
  $StateRoot = Get-PantheonStateRoot -Root $root
}
$StateRoot = [IO.Path]::GetFullPath($StateRoot)
$sourcePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "windows\PantheonSupervisor.cs"))
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Pantheon's Windows supervisor source is missing."
}

$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$binaryRoot = Join-Path $StateRoot "bin"
$binaryPath = Join-Path $binaryRoot "PantheonSupervisor-$($sourceHash.Substring(0, 16)).exe"
if (Test-Path -LiteralPath $binaryPath) {
  Write-Output $binaryPath
  exit 0
}

$compilerCandidates = @(
  (Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compilerPath = $compilerCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if ([string]::IsNullOrWhiteSpace([string]$compilerPath)) {
  throw "Pantheon could not find the Windows C# compiler required for reliable process supervision."
}

New-Item -ItemType Directory -Path $binaryRoot -Force | Out-Null
$temporaryPath = Join-Path $binaryRoot "PantheonSupervisor-$PID-$([guid]::NewGuid().ToString('N')).exe"
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $compilerPath
$startInfo.Arguments = "/nologo /target:exe /platform:anycpu /optimize+ /out:`"$temporaryPath`" `"$sourcePath`""
$startInfo.WorkingDirectory = $root
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$compiler = [Diagnostics.Process]::new()
$compiler.StartInfo = $startInfo
try {
  if (-not $compiler.Start()) {
    throw "Windows could not start Pantheon's supervisor compiler."
  }
  if (-not $compiler.WaitForExit(15000)) {
    try { $compiler.Kill() } catch {}
    throw "Pantheon's supervisor compiler exceeded its 15-second deadline."
  }
  $stdout = $compiler.StandardOutput.ReadToEnd()
  $stderr = $compiler.StandardError.ReadToEnd()
  if ($compiler.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryPath)) {
    throw "Pantheon's supervisor could not be compiled.`n$stdout`n$stderr"
  }
  try {
    [IO.File]::Move($temporaryPath, $binaryPath)
  } catch [IO.IOException] {
    if (-not (Test-Path -LiteralPath $binaryPath)) { throw }
  }
} finally {
  $compiler.Dispose()
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}

Write-Output $binaryPath
