[CmdletBinding()]
param(
  [string]$Source = "",
  [string]$Output = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Source) { $Source = Join-Path $scriptRoot "..\resources\su-shixia-icon.png" }
if (-not $Output) { $Output = Join-Path $scriptRoot "..\build\appx" }
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
New-Item -ItemType Directory -Force -Path $Output | Out-Null

function Save-Asset([string]$Name, [int]$Width, [int]$Height, [double]$IconScale = 0.82) {
  $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $size = [Math]::Max(1, [Math]::Floor([Math]::Min($Width, $Height) * $IconScale))
        $x = [Math]::Floor(($Width - $size) / 2)
        $y = [Math]::Floor(($Height - $size) / 2)
        $graphics.DrawImage($sourceImage, $x, $y, $size, $size)
      } finally {
        $graphics.Dispose()
      }
      $target = Join-Path $Output $Name
      $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "ATHENA_STORE_ASSET_OK $Name ${Width}x${Height}"
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $sourceImage.Dispose()
  }
}

Save-Asset "StoreLogo.png" 50 50 0.86
Save-Asset "Square44x44Logo.png" 44 44 0.86
Save-Asset "Square150x150Logo.png" 150 150 0.84
Save-Asset "Wide310x150Logo.png" 310 150 0.78
