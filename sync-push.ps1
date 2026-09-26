$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
git add data app components lib docs tests README.md package.json package-lock.json
$changes = git status --porcelain
if ($changes) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  git commit -m "data: sync Research OS $stamp"
}
git pull --rebase
git push
Write-Host "Research OS has been synced." -ForegroundColor Green
