$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message ==" -ForegroundColor Cyan
}

$packRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelsSource = Join-Path $packRoot "ollama-models\models"
$ollamaSetup = Join-Path $packRoot "OllamaSetup.exe"
$athenaInstaller = Get-ChildItem -Path $packRoot -Filter "Athena Setup *.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $athenaInstaller) {
  throw "Athena installer is missing from this offline pack."
}

if (-not (Test-Path $ollamaSetup)) {
  throw "OllamaSetup.exe is missing from this offline pack."
}

if (-not (Test-Path $modelsSource)) {
  throw "Bundled Ollama models are missing from this offline pack."
}

$ollamaExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollamaExe)) {
  $command = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
  if ($command) {
    $ollamaExe = $command.Source
  }
}

if (-not (Test-Path $ollamaExe)) {
  Write-Step "Install Ollama"
  Write-Host "The Ollama installer will open now. Finish it, then return to this window."
  Start-Process -FilePath $ollamaSetup -Wait
  Start-Sleep -Seconds 3
}

$ollamaExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollamaExe)) {
  $command = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
  if ($command) {
    $ollamaExe = $command.Source
  }
}

if (-not (Test-Path $ollamaExe)) {
  throw "Ollama was not found after installation. Install Ollama manually, then rerun this script."
}

Write-Step "Copy bundled model files"
$modelDestination = Join-Path $env:USERPROFILE ".ollama\models"
New-Item -ItemType Directory -Force -Path $modelDestination | Out-Null
robocopy $modelsSource $modelDestination /E /R:2 /W:2 /NFL /NDL /NP | Out-Host
$copyExitCode = $LASTEXITCODE
if ($copyExitCode -ge 8) {
  throw "Model copy failed. robocopy exit code: $copyExitCode"
}

Write-Step "Start Ollama"
if (-not (Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

Write-Step "Verify qwen2.5:14b"
$verified = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
    $names = @($response.models | ForEach-Object { $_.name })
    if ($names -contains "qwen2.5:14b") {
      $verified = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $verified) {
  throw "Ollama is running, but qwen2.5:14b was not visible in /api/tags."
}

Write-Step "Install Athena"
Write-Host "The Athena installer will open now."
Start-Process -FilePath $athenaInstaller.FullName -Wait

$athenaExe = Join-Path $env:LOCALAPPDATA "Programs\Athena\Athena.exe"
if (Test-Path $athenaExe) {
  Write-Step "Launch Athena"
  Start-Process -FilePath $athenaExe
  Write-Host "Athena is ready."
} else {
  Write-Host "Athena installation finished. Launch Athena from the Start Menu or desktop shortcut."
}
