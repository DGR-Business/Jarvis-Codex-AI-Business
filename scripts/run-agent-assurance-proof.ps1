[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProofRoot,
  [switch]$ResumeSubject,
  [ValidateRange(0, 200)][int]$PriorCostCents = 0,
  [switch]$AllowSemanticCorrection,
  [ValidateRange(600, 1200)][int]$SemanticMaxTokens = 1000,
  [ValidateRange(0.01, 10)][decimal]$AudPerUsd = 1.4327272727
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")

$credential = Read-PantheonOpenAICredential
if ($null -eq $credential) {
  throw "Pantheon OpenAI credential is unavailable. Run Connect OpenAI once for this Windows account."
}

$temporaryEnvironmentNames = @(
  "OPENAI_API_KEY",
  "PANTHEON_ASSURANCE_PROOF_ROOT",
  "PANTHEON_ASSURANCE_RESUME_SUBJECT",
  "PANTHEON_ASSURANCE_PRIOR_COST_CENTS",
  "PANTHEON_ALLOW_SEMANTIC_CORRECTION",
  "PANTHEON_SEMANTIC_REVIEW_MAX_TOKENS",
  "PANTHEON_API_CREDIT_AUD_PER_USD"
)
$previousEnvironment = @{}
foreach ($name in $temporaryEnvironmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  $env:OPENAI_API_KEY = [string]$credential.apiKey
  $env:PANTHEON_ASSURANCE_PROOF_ROOT = [IO.Path]::GetFullPath($ProofRoot)
  $env:PANTHEON_ASSURANCE_RESUME_SUBJECT = if ($ResumeSubject) { "1" } else { "0" }
  $env:PANTHEON_ASSURANCE_PRIOR_COST_CENTS = [string]$PriorCostCents
  $env:PANTHEON_ALLOW_SEMANTIC_CORRECTION = if ($AllowSemanticCorrection) { "1" } else { "0" }
  $env:PANTHEON_SEMANTIC_REVIEW_MAX_TOKENS = [string]$SemanticMaxTokens
  $env:PANTHEON_API_CREDIT_AUD_PER_USD = $AudPerUsd.ToString(
    [Globalization.CultureInfo]::InvariantCulture
  )

  & npm.cmd run proof:agent-assurance
  if ($LASTEXITCODE -ne 0) {
    throw "The agent-assurance proof exited with code $LASTEXITCODE."
  }
} finally {
  foreach ($name in $temporaryEnvironmentNames) {
    $previous = $previousEnvironment[$name]
    if ($null -eq $previous) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($name, [string]$previous, "Process")
    }
  }
}
