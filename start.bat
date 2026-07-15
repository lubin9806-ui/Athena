@echo off
setlocal
title Athena
cd /d "%~dp0"

tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if %errorlevel% neq 0 (
    if exist "%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe" (
        start /min "" "%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe" serve
    )
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing dependencies...
    call npm.cmd install
    if errorlevel 1 exit /b %errorlevel%
)

call npm.cmd run dev
