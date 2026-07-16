$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseRoot = Join-Path $repoRoot "release"
$packRoot = Join-Path $releaseRoot "Athena-Offline-Pack"
$modelManifest = Join-Path $repoRoot "docs\OFFLINE_MODEL_ALLOWLIST.json"
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

if (-not (Test-Path $modelManifest)) {
  throw "OFFLINE_MODEL_ALLOWLIST.json is required before creating an offline pack. It must list exact model files and SHA-256 hashes; copying the whole user Ollama model directory is not allowed."
}

$allowlist = Get-Content -Encoding UTF8 -LiteralPath $modelManifest | ConvertFrom-Json
if (-not $allowlist.files -or $allowlist.files.Count -eq 0) {
  throw "OFFLINE_MODEL_ALLOWLIST.json must contain a non-empty files array."
}

New-Item -ItemType Directory -Force -Path $packRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packRoot "ollama-models") | Out-Null

Copy-Item -Force -LiteralPath $installer.FullName -Destination (Join-Path $packRoot $installer.Name)
Copy-Item -Force -LiteralPath $ollamaSetup -Destination (Join-Path $packRoot "OllamaSetup.exe")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "scripts\install-offline.ps1") -Destination (Join-Path $packRoot "Install-Athena-Offline.ps1")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "scripts\START_HERE_OFFLINE.bat") -Destination (Join-Path $packRoot "START_HERE.bat")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "docs\OFFLINE_PACKAGE.md") -Destination (Join-Path $packRoot "README-OFFLINE.md")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "docs\THIRD_PARTY_NOTICES.md") -Destination (Join-Path $packRoot "THIRD_PARTY_NOTICES.md")

foreach ($file in $allowlist.files) {
  if (-not $file.source -or -not $file.destination -or -not $file.sha256) {
    throw "Each offline model file must include source, destination, and sha256."
  }
  $source = [Environment]::ExpandEnvironmentVariables([string]$file.source)
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Offline model source is missing: $source"
  }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToUpperInvariant()
  $expectedHash = ([string]$file.sha256).ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Hash mismatch for $source. Expected $expectedHash, got $actualHash."
  }
  $destination = Join-Path (Join-Path $packRoot "ollama-models") ([string]$file.destination)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -Force -LiteralPath $source -Destination $destination
}

$bytes = (Get-ChildItem -Recurse -Force $packRoot | Measure-Object -Property Length -Sum).Sum
$gb = [Math]::Round($bytes / 1GB, 2)

Write-Host "Athena offline pack ready:"
Write-Host "  $packRoot"
Write-Host "  Size: $gb GB"
