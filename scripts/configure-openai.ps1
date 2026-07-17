[CmdletBinding()]
param(
  [switch]$UseCurrentProcess,
  [switch]$Disconnect
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$privateRoot = Join-Path $root "private"
$credentialPath = Join-Path $privateRoot "runtime-credentials.json"

if ($Disconnect) {
  if (Test-Path -LiteralPath $credentialPath) {
    Remove-Item -LiteralPath $credentialPath -Force
  }
  Write-Host "The standalone OpenAI connection has been removed."
  exit 0
}

if ($UseCurrentProcess) {
  if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
    throw "The current process does not contain an OpenAI API key."
  }
  $secureKey = ConvertTo-SecureString $env:OPENAI_API_KEY -AsPlainText -Force
} else {
  $secureKey = Read-Host "Paste the restricted OpenAI API key" -AsSecureString
}

$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Length -lt 20) {
    throw "The OpenAI API key was empty or unexpectedly short."
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$aclTool = Get-Command icacls.exe -ErrorAction Stop
& $aclTool.Source $privateRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "The private credential folder permissions could not be restricted to this Windows account."
}

$profile = [ordered]@{
  version = 2
  openAiApiKeyProtected = ConvertFrom-SecureString $secureKey
  enableLiveModels = $true
  enableLiveResearch = $true
  enableImageGeneration = $true
  configuredAt = [DateTime]::UtcNow.ToString("o")
}
$temporaryPath = "$credentialPath.tmp"
$profile | ConvertTo-Json | Set-Content -LiteralPath $temporaryPath -Encoding utf8
Move-Item -LiteralPath $temporaryPath -Destination $credentialPath -Force

Write-Host "OpenAI is securely connected for this Windows account. Paid work still requires an exact Jarvis approval."
