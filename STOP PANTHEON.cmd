@echo off
setlocal
cd /d "%~dp0"
title Stop Pantheon

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-pantheon.ps1" -All %*
if errorlevel 1 (
  echo.
  echo Pantheon could not be stopped safely. The error above explains why.
  pause
)

endlocal
