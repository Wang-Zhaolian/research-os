$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
git pull --rebase --autostash
Write-Host "Research OS is up to date." -ForegroundColor Green
