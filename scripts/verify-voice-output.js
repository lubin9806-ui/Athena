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
let voiceForCleanup = null;

process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice-cache');
process.env.ATHENA_VOICE_SCRIPT_DIR = RUNTIME;

const { VoiceService } = require('../dist/core/voice/VoiceService.js');
const { saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');
const { takeSpeakableSentences, toSpeakableText, withSpokenTerminal } = require('../dist/renderer/voice/SpokenText.js');
const { StreamingReader } = require('../dist/renderer/voice/StreamingReader.js');

const SAMPLE = '这是当前音色的试听效果，用来验证语速、音量和音高。';

/** Rate is the clearest signal: the same words spoken faster take less time. */
const FASTER_RATE = 8;
/** Ratios rather than absolutes, because voices differ between machines. */
const MIN_RATE_SHORTENING = 0.15;
const MAX_QUIET_PEAK_RATIO = 0.75;
/** Clip padding budgets; tts_piper.py trims to 10ms lead and 90ms tail. */
const MAX_LEAD_SILENCE_MS = 40;
const MAX_TAIL_SILENCE_MS = 160;
const MIN_TAIL_SILENCE_MS = 40;

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
    ...silenceEdges(data, format),
  };
}

/**
 * Silence at each end, in milliseconds.
 *
 * A streamed reply is one clip per sentence, so this padding is not cosmetic:
 * it lands between two spoken sentences and adds up over a reply (ATH-VOICE-013).
 */
function silenceEdges(data, format) {
  const frames = Math.floor(data.length / 2 / format.channels);
  const hop = Math.max(1, Math.round(format.sampleRate * 0.01));
  if (frames < hop * 3) return { leadMs: 0, tailMs: 0 };

  const levels = [];
  for (let start = 0; start + hop <= frames; start += hop) {
    let total = 0;
    for (let index = start * format.channels; index < (start + hop) * format.channels; index += 1) {
      const value = data.readInt16LE(index * 2);
      total += value * value;
    }
    levels.push(Math.sqrt(total / (hop * format.channels)));
  }

  const peak = Math.max(...levels);
  if (peak <= 0) return { leadMs: 0, tailMs: 0 };
  const floor = peak * 0.02;
  const first = levels.findIndex(level => level > floor);
  if (first < 0) return { leadMs: 0, tailMs: 0 };
  let last = levels.length - 1;
  while (last > first && levels[last] <= floor) last -= 1;

  const msPerFrame = 1000 / format.sampleRate;
  return {
    leadMs: first * hop * msPerFrame,
    tailMs: (frames - (last + 1) * hop) * msPerFrame,
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

  check('an utterance with no mark of its own is given one', () => {
    assert.strictEqual(withSpokenTerminal('诊断函数只接一个 client'), '诊断函数只接一个 client。');
    assert.strictEqual(withSpokenTerminal('他说「已经好了」'), '他说「已经好了」。');
    // Punctuation the writer chose says how the line ends; it is not replaced.
    assert.strictEqual(withSpokenTerminal('我核实过了。'), '我核实过了。');
    assert.strictEqual(withSpokenTerminal('你想先修哪一个？'), '你想先修哪一个？');
    assert.strictEqual(withSpokenTerminal('要改的有三处：'), '要改的有三处：');
    assert.strictEqual(withSpokenTerminal('先说结论，'), '先说结论，');
  });

  // The trip wire for the real defect: markdown lines do not end in 。, and the
  // splitter treats a newline as a sentence end, so most of a normal reply used
  // to reach the engine with nothing telling it the thought was over.
  check('most of a normal reply reaches the engine with a terminal mark', () => {
    const reply = '## 连接测试的问题\n\n我核实过了。\n\n要改的有三处：\n\n- 诊断函数只接一个 client\n'
      + '- 探测预算写死成十六个 token\n- 绿灯不要求每条腿都过\n\n你想先修哪一个？';
    const lines = toSpeakableText(reply).split('\n').filter(Boolean);
    const bare = lines.filter(line => !/[。！？!?…；;：:，,、.]["'”’）)』」】]*$/.test(line));
    assert(
      bare.length / lines.length <= 0.2,
      `${bare.length} of ${lines.length} utterances carry no sentence-final punctuation: ${JSON.stringify(bare)}`,
    );
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
  voiceForCleanup = voice;
  const capabilities = await voice.getCapabilities();
  assert(capabilities.tts.voices.length > 0, 'No enabled Windows SAPI voices were detected.');
  const voiceName = capabilities.tts.voices[0].name;
  assert.strictEqual(capabilities.tts.piper.ready, true, capabilities.tts.piper.reason || 'The neural voice is not packaged.');
  assert.strictEqual(capabilities.tts.sapi.ready, true, capabilities.tts.sapi.reason || 'SAPI is not available.');

  /** Rate and volume are the two controls both engines implement. */
  async function verifyProfile(engine, label) {
    const base = { ttsEngine: engine, ttsVoice: voiceName, ttsRate: 0, ttsVolume: 100, ttsPitch: 0 };
    const normal = await synthesizeWith(voice, base, `${label} baseline`);
    const faster = await synthesizeWith(voice, { ...base, ttsRate: FASTER_RATE }, `${label} rate=${FASTER_RATE}`);
    const quiet = await synthesizeWith(voice, { ...base, ttsVolume: 20 }, `${label} volume=20`);

    const shortening = 1 - faster.durationMs / normal.durationMs;
    assert(
      shortening >= MIN_RATE_SHORTENING,
      `${label}: voice.ttsRate never reached the engine - rate ${FASTER_RATE} shortened the sample by `
      + `${round(shortening * 100)}%, under the ${round(MIN_RATE_SHORTENING * 100)}% floor `
      + `(${round(normal.durationMs)}ms -> ${round(faster.durationMs)}ms).`,
    );

    const peakRatio = quiet.peak / normal.peak;
    assert(
      peakRatio <= MAX_QUIET_PEAK_RATIO,
      `${label}: voice.ttsVolume never reached the engine - volume 20 peaked at `
      + `${round(peakRatio * 100)}% of volume 100, over the ${round(MAX_QUIET_PEAK_RATIO * 100)}% ceiling.`,
    );
    assert(normal.peak > 0.01, `${label}: the engine produced silence.`);

    console.log(
      `  ok  ${label}: rate ${round(normal.durationMs)}ms->${round(faster.durationMs)}ms `
      + `(-${round(shortening * 100)}%), volume peak ${round(normal.peak * 100)}%->${round(quiet.peak * 100)}%`,
    );
    return normal;
  }

  const piper = await verifyProfile('piper', 'piper');
  const sapi = await verifyProfile('sapi', 'sapi');

  // Every clip's own padding lands between two spoken sentences, so a reply read
  // one sentence at a time pays it once per sentence. Untrimmed this measured
  // 286ms per clip - 2.3 seconds of dead air across an eight-sentence reply, and
  // no voice or rate setting can remove it (ATH-VOICE-013).
  assert(
    piper.leadMs <= MAX_LEAD_SILENCE_MS,
    `piper clips start with ${round(piper.leadMs)}ms of silence, over the ${MAX_LEAD_SILENCE_MS}ms budget - `
    + 'a streamed reply pays this before every sentence.',
  );
  assert(
    piper.tailMs <= MAX_TAIL_SILENCE_MS,
    `piper clips end with ${round(piper.tailMs)}ms of silence, over the ${MAX_TAIL_SILENCE_MS}ms budget.`,
  );
  // The pause is deliberate, not absent: run together, sentences stop sounding
  // like sentences.
  assert(
    piper.tailMs >= MIN_TAIL_SILENCE_MS,
    `piper clips end with only ${round(piper.tailMs)}ms of silence, under the ${MIN_TAIL_SILENCE_MS}ms floor - `
    + 'the trim ate the pause between sentences.',
  );
  console.log(`  ok  piper clip padding: lead ${round(piper.leadMs)}ms, tail ${round(piper.tailMs)}ms`);

  // Pitch runs through SpeakSsml, which only exists on SAPI. A mismatched
  // xml:lang makes SAPI substitute another voice for the whole prompt, and that
  // shows up as a changed output format.
  const lower = await synthesizeWith(
    voice,
    { ttsEngine: 'sapi', ttsVoice: voiceName, ttsRate: 0, ttsVolume: 100, ttsPitch: -30 },
    'sapi pitch=-30',
  );
  assert(lower.peak > 0.01, 'voice.ttsPitch produced silence; the SSML path is broken.');
  assert.strictEqual(
    lower.sampleRate,
    sapi.sampleRate,
    'The SSML pitch path changed the output format, which means SAPI substituted a different voice.',
  );
  assert.strictEqual(
    capabilities.tts.supportsPitch,
    capabilities.tts.provider === 'sapi',
    'supportsPitch must track the engine that will actually speak; piper has no pitch parameter.',
  );

  // The engine setting has to pick the engine, not just be stored. Two different
  // synthesisers cannot produce the same bytes for the same sentence.
  assert.notStrictEqual(
    piper.bytes,
    sapi.bytes,
    'voice.ttsEngine never reached synthesis: both engines produced identically sized audio.',
  );
  console.log(
    `  ok  voice.ttsEngine selects the engine: piper ${round(piper.durationMs)}ms `
    + `vs sapi ${round(sapi.durationMs)}ms for the same sentence`,
  );

  console.log(`ATHENA_VOICE_OUTPUT_OK piper="${capabilities.tts.piper.voice}" sapi="${voiceName}"`);
}

function cleanupVoiceOutput() {
  try { voiceForCleanup?.dispose(); } catch {}
  voiceForCleanup = null;
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
