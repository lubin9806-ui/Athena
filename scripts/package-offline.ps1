$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseRoot = Join-Path $repoRoot "release"
$packRoot = Join-Path $releaseRoot "Athena-Offline-Pack"
$modelSource = Join-Path $env:USERPROFILE ".ollama\models"
$ollamaSetup = Join-Path $repoRoot "resources\OllamaSetup.exe"

$installer = Get-ChildItem -Path $releaseRoot -Filter "Athena Setup *.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No Athena installer found in $releaseRoot. Run npm.cmd run build first."
}

if (-not (Test-Path $ollamaSetup)) {
  throw "OllamaSetup.exe not found at $ollamaSetup."
}

if (-not (Test-Path $modelSource)) {
  throw "Ollama model directory not found at $modelSource."
}

New-Item -ItemType Directory -Force -Path $packRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packRoot "ollama-models") | Out-Null

Copy-Item -Force -LiteralPath $installer.FullName -Destination (Join-Path $packRoot $installer.Name)
Copy-Item -Force -LiteralPath $ollamaSetup -Destination (Join-Path $packRoot "OllamaSetup.exe")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "scripts\install-offline.ps1") -Destination (Join-Path $packRoot "Install-Athena-Offline.ps1")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "scripts\START_HERE_OFFLINE.bat") -Destination (Join-Path $packRoot "START_HERE.bat")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "docs\OFFLINE_PACKAGE.md") -Destination (Join-Path $packRoot "README-OFFLINE.md")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "docs\THIRD_PARTY_NOTICES.md") -Destination (Join-Path $packRoot "THIRD_PARTY_NOTICES.md")

$modelDestination = Join-Path $packRoot "ollama-models\models"
robocopy $modelSource $modelDestination /E /R:2 /W:2 /NFL /NDL /NP | Out-Host
$copyExitCode = $LASTEXITCODE
if ($copyExitCode -ge 8) {
  throw "robocopy failed while copying Ollama models. Exit code: $copyExitCode"
}

$bytes = (Get-ChildItem -Recurse -Force $packRoot | Measure-Object -Property Length -Sum).Sum
$gb = [Math]::Round($bytes / 1GB, 2)

Write-Host "Athena offline pack ready:"
Write-Host "  $packRoot"
Write-Host "  Size: $gb GB"
