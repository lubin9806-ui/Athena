const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const scratch = path.join(ROOT, 'temp', 'voice-service-verification');
const fixtureRoot = path.join(scratch, 'voice-scripts');
const modelRoot = path.join(scratch, 'whisper-model');
const tempRoot = path.join(scratch, 'voice-temp');

// Environment must be set before the compiled VoiceService resolves its roots.
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_VOICE_SCRIPT_DIR = fixtureRoot;
process.env.ATHENA_VOICE_TEMP_DIR = tempRoot;
process.env.ATHENA_PYTHON = process.execPath;
process.env.ATHENA_WHISPER_MODEL_DIR = modelRoot;

fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(fixtureRoot, { recursive: true });
fs.mkdirSync(modelRoot, { recursive: true });
fs.mkdirSync(tempRoot, { recursive: true });
fs.mkdirSync(path.join(scratch, 'config'), { recursive: true });

// Fake "STT runtime": node runs the .py file as JavaScript; it just sleeps.
fs.writeFileSync(path.join(fixtureRoot, 'stt_whisper.py'), [
  '// Fake long-running STT used by verify-voice-service.js cancellation tests.',
  'setTimeout(() => process.exit(0), 60_000);',
  '',
].join('\n'), 'utf8');
// Real PowerShell helpers are copied so synthesize/play can spawn them.
for (const helper of ['tts-local.ps1', 'play_audio_local.ps1', 'tts-capabilities.ps1']) {
  fs.copyFileSync(path.join(ROOT, helper), path.join(fixtureRoot, helper));
}
// Fake Whisper model layout expected by isWhisperModelDirectory.
fs.writeFileSync(path.join(modelRoot, 'config.json'), '{}', 'utf8');
fs.writeFileSync(path.join(modelRoot, 'model.bin'), 'fake', 'utf8');

const { VoiceService } = require('../dist/core/voice/VoiceService.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const service = new VoiceService();
  const sampleAudio = path.join(scratch, 'sample.wav');
  const sampleAudioB = path.join(scratch, 'sample-b.wav');
  fs.writeFileSync(sampleAudio, Buffer.alloc(2048, 1), 'utf8');
  fs.writeFileSync(sampleAudioB, Buffer.alloc(2048, 1), 'utf8');

  const emptySynthesize = await service.synthesize('');
  assert.equal(emptySynthesize.ok, false);
  assert.equal(emptySynthesize.code, 'input_error');

  const oversizedSynthesize = await service.synthesize('字'.repeat(4_001));
  assert.equal(oversizedSynthesize.ok, false);
  assert.equal(oversizedSynthesize.code, 'input_error');

  const relativeTranscribe = await service.transcribe('relative/audio.wav');
  assert.equal(relativeTranscribe.ok, false);
  assert.equal(relativeTranscribe.code, 'input_error');

  const missingTranscribe = await service.transcribe(path.join(scratch, 'missing.wav'));
  assert.equal(missingTranscribe.ok, false);
  assert.equal(missingTranscribe.code, 'input_error');

  const wrongExtension = await service.transcribe(path.join(scratch, 'sample.txt'));
  fs.writeFileSync(path.join(scratch, 'sample.txt'), 'not audio', 'utf8');
  assert.equal(wrongExtension.ok, false);
  assert.equal(wrongExtension.code, 'input_error');

  const directoryTranscribe = await service.transcribe(scratch);
  assert.equal(directoryTranscribe.ok, false);
  assert.equal(directoryTranscribe.code, 'input_error');

  const emptyRecording = await service.transcribeRecording(new Uint8Array(0));
  assert.equal(emptyRecording.ok, false);
  assert.equal(emptyRecording.code, 'input_error');

  const oversizedRecording = await service.transcribeRecording(new Uint8Array(33 * 1024 * 1024));
  assert.equal(oversizedRecording.ok, false);
  assert.equal(oversizedRecording.code, 'input_error');

  const relativePlay = await service.play('relative/audio.wav');
  assert.equal(relativePlay.ok, false);
  assert.equal(relativePlay.code, 'input_error');

  const missingPlay = await service.play(path.join(scratch, 'missing.wav'));
  assert.equal(missingPlay.ok, false);
  assert.equal(missingPlay.code, 'input_error');

  const directoryPlay = await service.play(scratch);
  assert.equal(directoryPlay.ok, false);
  assert.equal(directoryPlay.code, 'input_error');

  const transcribeController = new AbortController();
  const transcribing = service.transcribe(sampleAudio, transcribeController.signal);
  await sleep(400);
  const transcribeStartedAt = Date.now();
  transcribeController.abort();
  const cancelledTranscribe = await transcribing;
  assert.equal(cancelledTranscribe.ok, false, 'aborted transcribe must fail with a cancelled code');
  assert.equal(cancelledTranscribe.code, 'cancelled', `transcribe cancel must classify as cancelled: ${JSON.stringify(cancelledTranscribe)}`);
  assert(Date.now() - transcribeStartedAt < 10_000, 'aborted transcribe must return promptly');

  if (process.platform === 'win32') {
    const synthesizeController = new AbortController();
    const synthesizing = service.synthesize('合成取消测试。'.repeat(500), synthesizeController.signal);
    await sleep(150);
    const synthesizeStartedAt = Date.now();
    synthesizeController.abort();
    const cancelledSynthesize = await synthesizing;
    assert.equal(cancelledSynthesize.ok, false, 'aborted synthesize must fail');
    assert.equal(cancelledSynthesize.code, 'cancelled', `synthesize cancel must classify as cancelled: ${JSON.stringify(cancelledSynthesize)}`);
    assert(Date.now() - synthesizeStartedAt < 10_000, 'aborted synthesize must return promptly');
  }

  const firstCancelAll = service.transcribe(sampleAudio);
  const secondCancelAll = service.transcribe(sampleAudioB);
  await sleep(400);
  assert.equal(service.cancelAll(), 2, 'cancelAll must abort both in-flight voice operations');
  const [firstResult, secondResult] = await Promise.all([firstCancelAll, secondCancelAll]);
  assert.equal(firstResult.code, 'cancelled');
  assert.equal(secondResult.code, 'cancelled');
  assert.equal(service.cancelAll(), 0, 'cancelAll with no in-flight operations must report zero');

  // VoiceService now owns a resident recogniser whose working directory is the
  // fixture tree, so the scratch directory cannot be removed until it is let go.
  // The fake runtime never completes the handshake, which is also what proves
  // every assertion above ran through the one-shot fallback.
  service.dispose();
  removeScratch();
  console.log('ATHENA_VOICE_SERVICE_OK cancelled=classified input=validated fallback=one-shot');
}

function removeScratch() {
  // A killed child releases its working directory a moment later on Windows.
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  try { removeScratch(); } catch { /* Reporting the real failure matters more. */ }
});
