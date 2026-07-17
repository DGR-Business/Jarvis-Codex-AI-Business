@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-openai.ps1"
if errorlevel 1 pause
