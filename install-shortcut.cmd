@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-shortcut.ps1"
if errorlevel 1 (
  echo.
  echo Failed to create the desktop shortcut.
  pause >nul
  exit /b 1
)
pause
