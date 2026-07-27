@echo off
setlocal
cd /d "%~dp0"
title Start Pantheon

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-pantheon-control.ps1" %*
if errorlevel 1 (
  echo.
  echo Pantheon could not start. The error above explains what needs attention.
  pause
)

endlocal
