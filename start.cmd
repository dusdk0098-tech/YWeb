@echo off
rem YWeb launcher for Windows. First run installs packages, creates .env and the first account; see README.md.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
