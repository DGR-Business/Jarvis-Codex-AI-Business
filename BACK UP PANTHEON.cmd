@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-pantheon.ps1" %*
if errorlevel 1 (
  echo.
  echo Pantheon could not complete the encrypted backup. The error above explains what needs attention.
  pause
)

endlocal
