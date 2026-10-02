@echo off
cd /d "%~dp0"
node scripts\launch.mjs
if errorlevel 1 (
  echo.
  echo Research OS failed to start. Review the message above; press any key to close.
  pause >nul
  exit /b 1
)
