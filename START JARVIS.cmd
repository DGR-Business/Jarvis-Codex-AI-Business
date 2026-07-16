@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-jarvis.ps1" %*
if errorlevel 1 (
  echo.
  echo Jarvis could not start. The error above explains what needs attention.
  pause
)

endlocal
