@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-pantheon.ps1"
if errorlevel 1 (
  echo.
  echo Pantheon found an operating problem. The check above explains what needs attention.
  pause
)

endlocal
