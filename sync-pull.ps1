$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node scripts/sync.mjs pull
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
