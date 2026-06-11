$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envFile = Join-Path $repoRoot ".env.testnet"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing .env.testnet. Copy .env.testnet.example to .env.testnet and fill testnet-only credentials."
}

$env:SCALPSTATION_ENV_FILE = $envFile
Set-Location (Join-Path $repoRoot "backend")
npm run dev
