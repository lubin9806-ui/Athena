param([Parameter(Mandatory = $true)][string]$AudioFile)
$ErrorActionPreference = 'Stop'
$player = New-Object System.Media.SoundPlayer $AudioFile
try {
  $player.Load()
  $player.PlaySync()
  Write-Output "OK:$AudioFile"
} finally {
  $player.Dispose()
}
