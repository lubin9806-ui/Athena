$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
    [PSCustomObject]@{
      name = $_.VoiceInfo.Name
      culture = $_.VoiceInfo.Culture.Name
    }
  })
  [PSCustomObject]@{ voices = $voices } | ConvertTo-Json -Compress -Depth 3
} finally {
  $synth.Dispose()
}
