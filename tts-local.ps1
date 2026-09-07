param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $false)][string]$VoiceName = '',
  [Parameter(Mandatory = $false)][int]$Rate = 0,
  [Parameter(Mandatory = $false)][int]$Volume = 100,
  [Parameter(Mandatory = $false)][int]$PitchPercent = 0,
  [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($text)) { throw 'No text to speak.' }

# The caller clamps these too; refusing out-of-range values here keeps a direct
# invocation from producing silence or an exception deep inside SAPI.
if ($Rate -lt -10 -or $Rate -gt 10) { throw "Rate must be between -10 and 10, got $Rate." }
if ($Volume -lt 0 -or $Volume -gt 100) { throw "Volume must be between 0 and 100, got $Volume." }
if ($PitchPercent -lt -50 -or $PitchPercent -gt 50) { throw "PitchPercent must be between -50 and 50, got $PitchPercent." }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if (-not [string]::IsNullOrWhiteSpace($VoiceName)) { $synth.SelectVoice($VoiceName) }
  $synth.Rate = $Rate
  $synth.Volume = $Volume
  $synth.SetOutputToWaveFile($OutputFile)
  if ($PitchPercent -eq 0) {
    $synth.Speak($text)
  } else {
    # SpeechSynthesizer exposes rate and volume but not pitch, so pitch needs
    # SSML. xml:lang is taken from the voice that was actually selected -
    # a mismatch makes SAPI substitute a different voice for the whole prompt.
    # SpeechSynthesizer.Voice is already the VoiceInfo. An empty xml:lang makes
    # SAPI reject the whole prompt, so fall back rather than emit invalid SSML.
    $culture = ''
    if ($null -ne $synth.Voice -and $null -ne $synth.Voice.Culture) { $culture = $synth.Voice.Culture.Name }
    if ([string]::IsNullOrWhiteSpace($culture)) { $culture = [System.Globalization.CultureInfo]::CurrentCulture.Name }
    if ([string]::IsNullOrWhiteSpace($culture)) { $culture = 'en-US' }
    $escaped = [System.Security.SecurityElement]::Escape($text)
    $sign = if ($PitchPercent -gt 0) { '+' } else { '' }
    $ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + $culture + '">' +
      '<prosody pitch="' + $sign + $PitchPercent + '%">' + $escaped + '</prosody></speak>'
    $synth.SpeakSsml($ssml)
  }
  $synth.SetOutputToNull()
  Write-Output "OK:$OutputFile"
} finally {
  $synth.Dispose()
}
