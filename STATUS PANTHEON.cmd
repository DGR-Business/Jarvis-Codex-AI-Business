@echo off
setlocal
cd /d "%~dp0"
title Pantheon Status

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\status-pantheon.ps1" -All %*
if errorlevel 1 (
  echo.
  echo Pantheon could not read its status. The error above explains what needs attention.
  pause
) else (
  echo.
  pause
)

endlocal
