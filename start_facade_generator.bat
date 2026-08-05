@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_facade_generator.ps1"
if errorlevel 1 pause

