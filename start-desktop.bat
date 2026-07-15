@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Running npm install first...
  call npm.cmd install
  if errorlevel 1 exit /b %errorlevel%
)

if not exist "dist\app\main.js" (
  echo Building Athena desktop files...
  call npm.cmd run dev
  exit /b %ERRORLEVEL%
)

start "Athena" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
