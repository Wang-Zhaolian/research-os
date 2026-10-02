$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node scripts/sync.mjs push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
