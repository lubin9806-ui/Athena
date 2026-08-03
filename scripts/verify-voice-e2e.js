const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-voice-e2e-'));
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice-cache');
process.env.ATHENA_VOICE_SCRIPT_DIR = path.join(root, 'resources', 'voice-runtime');

async function main() {
  await app.whenReady();
  const { VoiceService } = require('../dist/core/voice/VoiceService.js');
  const voice = new VoiceService();
  const capabilities = await voice.getCapabilities();
  assert.strictEqual(capabilities.stt.ready, true, capabilities.stt.reason);
  assert.strictEqual(capabilities.tts.ready, true, capabilities.tts.reason);
  assert(capabilities.tts.voices.length > 0, 'No enabled Windows SAPI voices were detected.');

  const synthesized = await voice.synthesize('你好，雅典娜。现在进行本地语音测试。');
  assert.strictEqual(synthesized.ok, true, synthesized.error);
  assert(synthesized.audioPath && fs.existsSync(synthesized.audioPath), 'TTS WAV output is missing.');

  const transcribed = await voice.transcribe(synthesized.audioPath);
  assert.strictEqual(transcribed.ok, true, transcribed.error);
  assert(transcribed.text && transcribed.text.trim().length > 0, 'Whisper returned empty text.');
  console.log(JSON.stringify({
    marker: 'ATHENA_VOICE_E2E_OK',
    voices: capabilities.tts.voices,
    transcription: transcribed.text,
  }));
}

main().finally(() => {
  delete process.env.ATHENA_CONFIG_DIR;
  delete process.env.ATHENA_DB_DIR;
  delete process.env.ATHENA_VOICE_TEMP_DIR;
  delete process.env.ATHENA_VOICE_SCRIPT_DIR;
  fs.rmSync(scratch, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(`ATHENA_VOICE_E2E_FAILED ${error.message}`);
  process.exitCode = 1;
});
