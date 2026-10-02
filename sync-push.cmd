@echo off
setlocal
cd /d "%~dp0"
node scripts\sync.mjs push
if errorlevel 1 exit /b 1
