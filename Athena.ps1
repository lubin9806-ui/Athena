$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ollama = Join-Path $env:USERPROFILE "AppData\Local\Programs\Ollama\ollama.exe"
$ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if (-not $ollamaRunning -and (Test-Path $ollama)) {
    Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
}

if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
    & npm.cmd install
}

& npm.cmd run dev
