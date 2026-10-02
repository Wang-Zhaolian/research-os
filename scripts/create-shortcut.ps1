$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot "start-research-os.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not (Test-Path -LiteralPath $launcher)) { throw "找不到 Research OS 启动脚本：$launcher" }

$shell = New-Object -ComObject WScript.Shell
$shortcutPath = $null
for ($index = 1; $index -le 100; $index++) {
  $name = if ($index -eq 1) { "Research OS.lnk" } else { "Research OS Local ($index).lnk" }
  $candidate = Join-Path $desktop $name
  if (-not (Test-Path -LiteralPath $candidate)) { $shortcutPath = $candidate; break }
  $existing = $shell.CreateShortcut($candidate)
  if ($existing.TargetPath -and [IO.Path]::GetFullPath($existing.TargetPath) -eq [IO.Path]::GetFullPath($launcher)) { $shortcutPath = $candidate; break }
}
if (-not $shortcutPath) { throw "No free Research OS shortcut name is available on the desktop." }
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Start local Research OS"
$shortcut.Save()
Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
