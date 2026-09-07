/**
 * The voice profile has to be audible, not just storable.
 *
 * Rate, volume and pitch are settings a person changes and then expects to hear.
 * A control that is saved but never reaches SAPI looks identical in the UI, so
 * this suite asserts against the synthesized audio itself: a faster rate must
 * produce a shorter file, a lower volume a quieter one, and a pitch shift must
 * take the SSML path without losing the selected voice.
 *
 * Everything goes through saveSettingsBundle rather than script arguments, so
 * what is proven is the whole path from the settings form down to the WAV.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.resolve(process.env.ATHENA_VOICE_RUNTIME_DIR || path.join(ROOT, 'resources', 'voice-runtime'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-voice-output-'));

process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice-cache');
process.env.ATHENA_VOICE_SCRIPT_DIR = RUNTIME;

const { VoiceService } = require('../dist/core/voice/VoiceService.js');
const { saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');
const { takeSpeakableSentences, toSpeakableText } = require('../dist/renderer/voice/SpokenText.js');
const { StreamingReader } = require('../dist/renderer/voice/StreamingReader.js');

const SAMPLE = '这是当前音色的试听效果，用来验证语速、音量和音高。';

/** Rate is the clearest signal: the same words spoken faster take less time. */
const FASTER_RATE = 8;
/** Ratios rather than absolutes, because voices differ between machines. */
const MIN_RATE_SHORTENING = 0.15;
const MAX_QUIET_PEAK_RATIO = 0.75;

/** Parse a PCM WAV by walking its chunks; SAPI's header layout is not fixed. */
function readWav(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert(buffer.length > 44, `${filePath} is too small to be a WAV.`);
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'RIFF', 'Not a RIFF file.');
  assert.strictEqual(buffer.toString('ascii', 8, 12), 'WAVE', 'Not a WAVE file.');

  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(buffer.length, body + size));
    }
    // Chunks are word-aligned, so an odd size carries a pad byte.
    offset = body + size + (size % 2);
  }

  assert(format, 'WAV has no fmt chunk.');
  assert(data, 'WAV has no data chunk.');
  assert.strictEqual(format.bitsPerSample, 16, `Expected 16-bit PCM, got ${format.bitsPerSample}.`);

  let peak = 0;
  for (let index = 0; index + 1 < data.length; index += 2) {
    peak = Math.max(peak, Math.abs(data.readInt16LE(index)));
  }

  return {
    durationMs: (data.length / format.byteRate) * 1000,
    peak: peak / 32768,
    bytes: data.length,
    sampleRate: format.sampleRate,
  };
}

async function synthesizeWith(voice, profile, label) {
  saveSettingsBundle({ settings: { voice: profile } });
  const result = await voice.synthesize(SAMPLE);
  assert.strictEqual(result.ok, true, `${label}: ${result.error}`);
  assert(result.audioPath && fs.existsSync(result.audioPath), `${label}: no WAV was produced.`);
  const measured = readWav(result.audioPath);
  // Keep the file: comparisons run after every profile has been synthesized.
  return { ...measured, audioPath: result.audioPath };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function check(name, run) {
  run();
  console.log(`  ok  ${name}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** What a reply sounds like: markdown removed, sentences in order. */
function verifySpokenText() {
  check('code blocks are not read aloud', () => {
    const spoken = toSpeakableText('先看这段：\n```js\nconst x = 1;\n```\n就是这样。');
    assert(!spoken.includes('const'), `code leaked into speech: ${spoken}`);
    assert(spoken.includes('先看这段'), 'text around the block was lost');
    assert(spoken.includes('就是这样'), 'text after the block was lost');
  });

  check('emphasis and links keep their words, not their markup', () => {
    const spoken = toSpeakableText('这是 **重点**，见 [文档](https://example.com/a_b) 与 `code`。');
    assert(!spoken.includes('*'), `emphasis markers survived: ${spoken}`);
    assert(!spoken.includes('http'), `a URL would be read out: ${spoken}`);
    assert(spoken.includes('重点') && spoken.includes('文档') && spoken.includes('code'), spoken);
  });

  check('headings, bullets and table rules lose only their markers', () => {
    const spoken = toSpeakableText('## 标题\n- 第一点\n- 第二点\n\n| 列 | 值 |\n|---|---|\n| 甲 | 乙 |');
    assert(!spoken.includes('##') && !spoken.includes('- ') && !spoken.includes('|---'), spoken);
    assert(spoken.includes('标题') && spoken.includes('第一点') && spoken.includes('甲'), spoken);
  });

  check('a finished sentence is taken and an unfinished one is held', () => {
    const { sentences, rest } = takeSpeakableSentences('今天下午三点提醒我。还有一件事');
    assert.deepStrictEqual(sentences, ['今天下午三点提醒我。']);
    assert.strictEqual(rest, '还有一件事');
  });

  check('an English full stop ends a sentence but a decimal does not', () => {
    const split = takeSpeakableSentences('Send the report. It is 3.14 metres long');
    assert.deepStrictEqual(split.sentences, ['Send the report.']);
    assert.strictEqual(split.rest, 'It is 3.14 metres long');
  });

  check('an unpunctuated stretch is spoken instead of held forever', () => {
    // Well past the 120-character backstop, which is the case this exists for:
    // a reply that never punctuates would otherwise be held until it ended.
    const long = '这句话没有任何标点符号所以永远不会结束'.repeat(12);
    const { sentences, rest } = takeSpeakableSentences(long);
    assert(sentences.length > 0, 'a long unpunctuated reply would never start speaking');
    assert(rest.length > 0, 'the forced break consumed the whole buffer instead of one chunk');
  });

  check('the end of a reply speaks whatever is left', () => {
    const { sentences, rest } = takeSpeakableSentences('没有句号的结尾', true);
    assert.deepStrictEqual(sentences, ['没有句号的结尾']);
    assert.strictEqual(rest, '');
  });
}

/** The behaviour streaming exists for: speaking starts before the reply ends. */
async function verifyStreamingReader() {
  const spoken = [];
  const played = [];
  let firstClip = false;
  const gate = deferred();
  let finished = null;

  const reader = new StreamingReader({
    synthesize: async (text) => { spoken.push(text); return `clip-${spoken.length}.wav`; },
    playToEnd: async (audioPath) => {
      played.push(audioPath);
      // Hold the first clip so the pipelining can be observed while it "plays".
      if (played.length === 1) await gate.promise;
    },
    onFirstClip: () => { firstClip = true; },
    onFinish: (cancelled) => { finished = { cancelled }; },
    onError: (error) => { throw error; },
  });

  // Deliberately without a newline. Buffering by whole lines looked like the
  // safe way to track code fences, but a streaming reply often has no line break
  // until it ends - and the reader then stayed silent until the reply was over,
  // which is the delay this class exists to remove.
  reader.push('第一句话已经写完了。');
  reader.push('第一句话已经写完了。第二句也写完了。');
  await new Promise(resolve => setTimeout(resolve, 120));

  assert(firstClip, 'the reader never started speaking while the reply was still arriving');
  assert.strictEqual(finished, null, 'the reader finished before the reply did');
  assert.deepStrictEqual(played, ['clip-1.wav'], `unexpected playback order: ${played}`);
  // The point of the pipeline: the second sentence is already being synthesized
  // while the first is playing, so a boundary is not a silent PowerShell start.
  assert.strictEqual(
    spoken.length,
    2,
    `synthesis is not running ahead of playback: ${spoken.length} clip(s) prepared while one played`,
  );

  gate.resolve();
  reader.push('第一句话已经写完了。第二句也写完了。收尾。');
  reader.finish();
  for (let attempt = 0; attempt < 50 && !finished; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert(finished && !finished.cancelled, 'the reader never finished');
  assert.deepStrictEqual(spoken, ['第一句话已经写完了。', '第二句也写完了。', '收尾。'], `spoken: ${spoken}`);
  assert.deepStrictEqual(played, ['clip-1.wav', 'clip-2.wav', 'clip-3.wav'], `played: ${played}`);
  console.log('  ok  reading starts mid-reply and keeps one clip synthesized ahead');
}

async function verifyStreamingReaderCancel() {
  const played = [];
  let finished = null;
  const gate = deferred();
  const reader = new StreamingReader({
    synthesize: async () => 'clip.wav',
    playToEnd: async (audioPath) => { played.push(audioPath); await gate.promise; },
    onFirstClip: () => {},
    onFinish: (cancelled) => { finished = { cancelled }; },
    onError: () => {},
  });

  reader.push('一句话。二句话。三句话。');
  await new Promise(resolve => setTimeout(resolve, 60));
  reader.cancel();
  gate.resolve();
  for (let attempt = 0; attempt < 50 && !finished; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert(finished && finished.cancelled, 'cancelling did not report a cancelled finish');
  assert.strictEqual(played.length, 1, `cancelling let ${played.length} clips play`);
  console.log('  ok  cancelling stops the reading rather than draining the queue');
}

async function main() {
  assert(fs.existsSync(RUNTIME), `Managed voice runtime is missing at ${RUNTIME}.`);

  // Pure checks first: they describe what gets spoken, and they run everywhere.
  verifySpokenText();
  await verifyStreamingReader();
  await verifyStreamingReaderCancel();

  if (process.platform !== 'win32') {
    console.log('ATHENA_VOICE_OUTPUT_SKIPPED reason=local-tts-is-windows-only');
    return;
  }

  const voice = new VoiceService();
  const capabilities = await voice.getCapabilities();
  assert.strictEqual(capabilities.tts.ready, true, capabilities.tts.reason || 'Local TTS is not ready.');
  assert(capabilities.tts.voices.length > 0, 'No enabled Windows SAPI voices were detected.');
  const voiceName = capabilities.tts.voices[0].name;

  const base = { ttsVoice: voiceName, ttsRate: 0, ttsVolume: 100, ttsPitch: 0 };
  const normal = await synthesizeWith(voice, base, 'baseline');
  const faster = await synthesizeWith(voice, { ...base, ttsRate: FASTER_RATE }, `rate=${FASTER_RATE}`);
  const quiet = await synthesizeWith(voice, { ...base, ttsVolume: 20 }, 'volume=20');
  const lower = await synthesizeWith(voice, { ...base, ttsPitch: -30 }, 'pitch=-30');

  const shortening = 1 - faster.durationMs / normal.durationMs;
  assert(
    shortening >= MIN_RATE_SHORTENING,
    `voice.ttsRate never reached SAPI: rate ${FASTER_RATE} shortened the sample by `
    + `${round(shortening * 100)}%, under the ${round(MIN_RATE_SHORTENING * 100)}% floor `
    + `(${round(normal.durationMs)}ms -> ${round(faster.durationMs)}ms).`,
  );

  const peakRatio = quiet.peak / normal.peak;
  assert(
    peakRatio <= MAX_QUIET_PEAK_RATIO,
    `voice.ttsVolume never reached SAPI: volume 20 peaked at ${round(peakRatio * 100)}% of volume 100, `
    + `over the ${round(MAX_QUIET_PEAK_RATIO * 100)}% ceiling.`,
  );

  // Pitch runs through SpeakSsml, a different code path in the script. It has to
  // still produce real audio at the same format - a mismatched xml:lang makes
  // SAPI substitute another voice, which shows up as a changed sample rate.
  assert(lower.bytes > 0, 'voice.ttsPitch produced an empty WAV.');
  assert(lower.peak > 0.01, 'voice.ttsPitch produced silence; the SSML path is broken.');
  assert.strictEqual(
    lower.sampleRate,
    normal.sampleRate,
    'The SSML pitch path changed the output format, which means SAPI substituted a different voice.',
  );

  console.log(
    `ATHENA_VOICE_OUTPUT_OK voice="${voiceName}" `
    + `rate=${round(normal.durationMs)}ms->${round(faster.durationMs)}ms (-${round(shortening * 100)}%) `
    + `volume=peak ${round(normal.peak * 100)}%->${round(quiet.peak * 100)}% `
    + `pitch=ssml ok at ${lower.sampleRate}Hz`,
  );
}

function cleanupVoiceOutput() {
  delete process.env.ATHENA_CONFIG_DIR;
  delete process.env.ATHENA_DB_DIR;
  delete process.env.ATHENA_VOICE_TEMP_DIR;
  delete process.env.ATHENA_VOICE_SCRIPT_DIR;
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}

main()
  .then(() => { cleanupVoiceOutput(); })
  .catch((error) => {
    console.error(`ATHENA_VOICE_OUTPUT_FAILED ${error?.message || error}`);
    cleanupVoiceOutput();
    process.exitCode = 1;
  });
