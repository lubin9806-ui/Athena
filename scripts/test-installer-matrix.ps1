[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$PreviousInstaller,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\Athena-Beta-QA"),
  [switch]$KeepInstalled
)

$ErrorActionPreference = "Stop"
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$previousPath = if ($PreviousInstaller) { (Resolve-Path -LiteralPath $PreviousInstaller).Path } else { $null }
$evidenceRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("athena-installer-matrix-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Scenario, [string]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{ scenario = $Scenario; status = $Status; detail = $Detail; at = [datetime]::UtcNow.ToString("o") })
  Write-Host "ATHENA_INSTALL_MATRIX $Scenario $Status $Detail"
}

function Invoke-Installer([string]$Path, [string]$Scenario) {
  $process = Start-Process -FilePath $Path -ArgumentList @("/S", "/D=$InstallRoot") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "$Scenario installer exited $($process.ExitCode)" }
  $app = Join-Path $InstallRoot "Athena.exe"
  if (-not (Test-Path -LiteralPath $app)) { throw "$Scenario did not create $app" }
  Add-Result $Scenario "PASS" "installerExit=0"
}

function Invoke-Smoke([string]$Scenario, [hashtable]$Environment = @{}) {
  $app = Join-Path $InstallRoot "Athena.exe"
  $stdout = Join-Path $evidenceRoot ($Scenario + ".stdout.log")
  $stderr = Join-Path $evidenceRoot ($Scenario + ".stderr.log")
  $oldValues = @{}
  foreach ($key in $Environment.Keys) { $oldValues[$key] = [Environment]::GetEnvironmentVariable($key); [Environment]::SetEnvironmentVariable($key, $Environment[$key]) }
  try {
    $process = Start-Process -FilePath $app -ArgumentList "--smoke-test" -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } finally {
    foreach ($key in $Environment.Keys) { [Environment]::SetEnvironmentVariable($key, $oldValues[$key]) }
  }
  $output = (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
  if ($process.ExitCode -ne 0 -or $output -notmatch "ATHENA_SMOKE_READY_TO_SHOW" -or $output -notmatch "ATHENA_SMOKE_DOM_OK") {
    throw "$Scenario smoke failed; evidence=$evidenceRoot"
  }
  Add-Result $Scenario "PASS" "READY_TO_SHOW+DOM_OK"
}

function Invoke-Uninstall([string]$Scenario) {
  $uninstaller = Join-Path $InstallRoot "Uninstall Athena.exe"
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller missing: $uninstaller" }
  $process = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "$Scenario uninstaller exited $($process.ExitCode)" }
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath (Join-Path $InstallRoot "Athena.exe")) { throw "$Scenario left Athena.exe installed" }
  Add-Result $Scenario "PASS" "uninstallerExit=0"
}

try {
  if ($previousPath) {
    Invoke-Installer $previousPath "previous-version-install"
    Invoke-Smoke "previous-version-smoke"
    Invoke-Installer $installerPath "cross-version-upgrade"
    Invoke-Smoke "cross-version-upgrade-smoke"
  } else {
    Add-Result "cross-version-upgrade" "NOT_RUN" "PreviousInstaller was not supplied"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "Athena.exe"))) { Invoke-Installer $installerPath "first-install" }
  Invoke-Smoke "first-install-smoke"
  Invoke-Installer $installerPath "in-place-upgrade"
  Invoke-Smoke "in-place-upgrade-smoke"

  $offlineConfig = Join-Path $evidenceRoot "model-offline.json"
  '{"ollama":{"baseUrl":"http://127.0.0.1:1","model":"qwen2.5:14b"}}' | Set-Content -LiteralPath $offlineConfig -Encoding UTF8
  Invoke-Smoke "without-ollama" @{ ATHENA_MODEL_CONFIG = $offlineConfig }

  Invoke-Uninstall "uninstall"
  Invoke-Installer $installerPath "reinstall"
  Invoke-Smoke "reinstall-smoke"
  if (-not $KeepInstalled) { Invoke-Uninstall "final-uninstall" }
} catch {
  Add-Result "matrix" "FAIL" $_.Exception.Message
  throw
} finally {
  $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidenceRoot "results.json") -Encoding UTF8
  Write-Host "ATHENA_INSTALL_MATRIX_EVIDENCE $evidenceRoot"
}
