@echo off
setlocal
cd /d "%~dp0"
title Start Pantheon Rehearsal

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-pantheon.ps1" -JourneyRehearsal %*
if errorlevel 1 (
  echo.
  echo The isolated Pantheon rehearsal could not start. The error above explains what needs attention.
  pause
)

endlocal
