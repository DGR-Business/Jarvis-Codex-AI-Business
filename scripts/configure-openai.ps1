[CmdletBinding()]
param(
  [switch]$UseCurrentProcess,
  [switch]$Disconnect,
  [switch]$RemoveUserEnvironmentKey
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")
$credentialPath = Get-PantheonOpenAICredentialPath

if ($Disconnect) {
  if (Test-Path -LiteralPath $credentialPath) {
    Remove-Item -LiteralPath $credentialPath -Force
  }
  Write-Host "Pantheon's protected OpenAI connection has been removed."
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

$credentialPath = Write-PantheonOpenAICredential -ApiKey $secureKey
if ($RemoveUserEnvironmentKey) {
  [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $null, "User")
}

Write-Host "OpenAI is securely connected for Pantheon on this Windows account. Internal AI work remains budget-controlled and consequential outside actions stay protected."
Write-Host "Protected credential: $credentialPath"
