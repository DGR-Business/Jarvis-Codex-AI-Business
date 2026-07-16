@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-jarvis.ps1" %*
if errorlevel 1 (
  echo.
  echo Jarvis could not be stopped safely. The error above explains why.
  pause
)

endlocal
