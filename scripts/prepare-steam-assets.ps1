param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Save-CroppedPng {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [double]$FocusX = 0.5,
    [double]$FocusY = 0.5
  )

  $sourceBitmap = [System.Drawing.Bitmap]::FromFile($Source)
  try {
    $sourceRatio = $sourceBitmap.Width / $sourceBitmap.Height
    $targetRatio = $Width / $Height
    if ($sourceRatio -gt $targetRatio) {
      $cropHeight = $sourceBitmap.Height
      $cropWidth = [int][Math]::Round($cropHeight * $targetRatio)
    } else {
      $cropWidth = $sourceBitmap.Width
      $cropHeight = [int][Math]::Round($cropWidth / $targetRatio)
    }
    $centerX = [Math]::Max(0, [Math]::Min($sourceBitmap.Width, $sourceBitmap.Width * $FocusX))
    $centerY = [Math]::Max(0, [Math]::Min($sourceBitmap.Height, $sourceBitmap.Height * $FocusY))
    $cropX = [int][Math]::Round([Math]::Max(0, [Math]::Min($sourceBitmap.Width - $cropWidth, $centerX - ($cropWidth / 2))))
    $cropY = [int][Math]::Round([Math]::Max(0, [Math]::Min($sourceBitmap.Height - $cropHeight, $centerY - ($cropHeight / 2))))
    $targetBitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($targetBitmap)
      try {
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $sourceRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropWidth, $cropHeight)
        $targetRect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
        $graphics.DrawImage($sourceBitmap, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }
      $directory = Split-Path -Parent $Destination
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
      $targetBitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $targetBitmap.Dispose()
    }
  } finally {
    $sourceBitmap.Dispose()
  }
  Write-Host "ATHENA_STEAM_ASSET_OK $([IO.Path]::GetFileName($Destination)) ${Width}x${Height}"
}

$assets = Join-Path $Root 'assets\steam'
$main = Join-Path $assets 'source\athena-athens-main-master.png'
$vertical = Join-Path $assets 'source\athena-athens-vertical-master.png'
$hero = Join-Path $assets 'source\athena-athens-library-hero-master.png'

foreach ($source in @($main, $vertical, $hero)) {
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing Steam source asset: $source" }
}

Save-CroppedPng -Source $main -Destination (Join-Path $assets 'store\header_capsule.png') -Width 920 -Height 430
Save-CroppedPng -Source $main -Destination (Join-Path $assets 'store\small_capsule.png') -Width 462 -Height 174
Save-CroppedPng -Source $main -Destination (Join-Path $assets 'store\main_capsule.png') -Width 1232 -Height 706
Save-CroppedPng -Source $vertical -Destination (Join-Path $assets 'store\vertical_capsule.png') -Width 748 -Height 896 -FocusY 0.58
Save-CroppedPng -Source $vertical -Destination (Join-Path $assets 'library\library_capsule.png') -Width 600 -Height 900
Save-CroppedPng -Source $main -Destination (Join-Path $assets 'library\library_header.png') -Width 920 -Height 430
Save-CroppedPng -Source $hero -Destination (Join-Path $assets 'library\library_hero.png') -Width 3840 -Height 1240

# The sculpture occupies the left portion of the landscape master. This crop intentionally excludes the wordmark.
$iconSource = [System.Drawing.Bitmap]::FromFile($main)
try {
  $iconCrop = New-Object System.Drawing.Bitmap(700, 700, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($iconCrop)
    try {
      $graphics.DrawImage($iconSource, (New-Object System.Drawing.Rectangle(0, 0, 700, 700)), (New-Object System.Drawing.Rectangle(30, 105, 700, 700)), [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $graphics.Dispose()
    }
    $iconMaster = Join-Path $assets 'source\athena-athens-icon-master.png'
    $iconCrop.Save($iconMaster, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $iconCrop.Dispose()
  }
} finally {
  $iconSource.Dispose()
}

Save-CroppedPng -Source (Join-Path $assets 'source\athena-athens-icon-master.png') -Destination (Join-Path $assets 'community\shortcut_icon_256.png') -Width 256 -Height 256
Save-CroppedPng -Source (Join-Path $assets 'source\athena-athens-icon-master.png') -Destination (Join-Path $assets 'community\app_icon_184.png') -Width 184 -Height 184
