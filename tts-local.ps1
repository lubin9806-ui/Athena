param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $false)][string]$VoiceName = '',
  [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($text)) { throw 'No text to speak.' }
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if (-not [string]::IsNullOrWhiteSpace($VoiceName)) { $synth.SelectVoice($VoiceName) }
  $synth.SetOutputToWaveFile($OutputFile)
  $synth.Speak($text)
  $synth.SetOutputToNull()
  Write-Output "OK:$OutputFile"
} finally {
  $synth.Dispose()
}
