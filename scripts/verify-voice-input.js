/**
 * Baseline measurement for the voice input path.
 *
 * Window 05 requires reproducible evidence before a latency or accuracy claim.
 * This suite splits one dictation into the phases that actually cost time, so a
 * later change has a number to beat instead of an impression:
 *
 *   preflight   getCapabilities() - spawns `python --version` AND a PowerShell
 *               SAPI voice enumeration, both of which VoiceService.transcribe
 *               currently pays on every single utterance.
 *   interpreter managed CPython boot.
 *   import      faster_whisper import cost inside that interpreter.
 *   modelLoad   WhisperModel construction from the local model directory.
 *   decode      the transcription itself (direct spawn minus model load).
 *
 * Fixtures are SAPI speech, not human speech, so the accuracy numbers measure
 * the pipeline and its language routing - not real-world microphone accuracy.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.resolve(process.env.ATHENA_VOICE_RUNTIME_DIR || path.join(ROOT, 'resources', 'voice-runtime'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-voice-input-'));

process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice-cache');
process.env.ATHENA_VOICE_SCRIPT_DIR = RUNTIME;

const { VoiceService } = require('../dist/core/voice/VoiceService.js');

/**
 * transcribe() minus the equivalent direct spawn. Measured at ~343 ms while the
 * capability preflight sat on the hot path; noise-level once it was removed.
 */
const MAX_HOT_PATH_OVERHEAD_MS = 150;

const FIXTURES = [
  {
    id: 'zh',
    culture: 'zh',
    text: '今天下午三点提醒我给团队发周报。',
    // A Chinese fixture must survive the pipeline for the suite to mean anything.
    required: true,
    floor: 0.5,
  },
  {
    id: 'en',
    culture: 'en',
    text: 'Remind me to send the weekly report at three in the afternoon.',
    // Recorded, not gated: stt_whisper.py pins language="zh", so English is
    // currently decoded as Chinese. The floor arrives with the language fix.
    required: false,
    floor: 0,
  },
];

function pythonEnv() {
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
  };
}

function runPython(python, args, timeoutMs) {
  const started = process.hrtime.bigint();
  const result = spawnSync(python, args, {
    cwd: RUNTIME,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    env: pythonEnv(),
  });
  return {
    ms: Number(process.hrtime.bigint() - started) / 1e6,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

async function timed(run) {
  const started = process.hrtime.bigint();
  const value = await run();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, value };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/** Latin text compares by word, CJK by character; both ignore punctuation. */
function tokenize(text, culture) {
  const cleaned = text.replace(/[\s\p{P}\p{S}]+/gu, culture === 'en' ? ' ' : '').trim();
  return culture === 'en' ? cleaned.toLowerCase().split(/\s+/).filter(Boolean) : [...cleaned];
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = left[row - 1] === right[column - 1]
        ? previous[column - 1]
        : 1 + Math.min(previous[column - 1], previous[column], current[column - 1]);
    }
    previous = current;
  }
  return previous[right.length];
}

/** 1 means identical, 0 means nothing recovered. */
function similarity(expected, actual, culture) {
  const left = tokenize(expected, culture);
  const right = tokenize(actual, culture);
  if (left.length === 0) return right.length === 0 ? 1 : 0;
  return Math.max(0, 1 - editDistance(left, right) / left.length);
}

async function main() {
  assert(fs.existsSync(RUNTIME), `Managed voice runtime is missing at ${RUNTIME}. Run npm.cmd run prepare:voice-runtime.`);
  const voice = new VoiceService();

  const capabilities = await voice.getCapabilities();
  assert.strictEqual(capabilities.stt.ready, true, capabilities.stt.reason || 'Local STT is not ready.');
  assert.strictEqual(capabilities.tts.ready, true, capabilities.tts.reason || 'Local TTS is not ready.');

  const python = capabilities.stt.runtimePath;
  const modelDir = capabilities.stt.modelPath;
  const sttScript = path.join(RUNTIME, 'stt_whisper.py');
  assert(fs.existsSync(sttScript), `stt_whisper.py is missing at ${sttScript}.`);

  // Preflight is measured on its own because transcribe() pays it per utterance.
  const preflightSamples = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    preflightSamples.push((await timed(() => voice.getCapabilities())).ms);
  }
  const preflightMs = median(preflightSamples);

  const interpreter = runPython(python, ['-c', 'pass'], 30_000);
  assert.strictEqual(interpreter.status, 0, interpreter.stderr || 'Managed interpreter failed to start.');

  const imported = runPython(python, ['-c', 'import faster_whisper'], 60_000);
  assert.strictEqual(imported.status, 0, imported.stderr || 'faster_whisper import failed.');

  const modelLiteral = JSON.stringify(modelDir.replace(/\\/g, '/'));
  const loaded = runPython(python, [
    '-c',
    'from faster_whisper import WhisperModel; '
    + `WhisperModel(${modelLiteral}, device="cpu", compute_type="int8", cpu_threads=2, num_workers=1, local_files_only=True)`,
  ], 120_000);
  assert.strictEqual(loaded.status, 0, loaded.stderr || 'WhisperModel construction failed.');

  const available = new Map();
  for (const installed of capabilities.tts.voices) {
    const culture = installed.culture.slice(0, 2).toLowerCase();
    if (!available.has(culture)) available.set(culture, installed.name);
  }

  const results = [];
  const skipped = [];
  for (const fixture of FIXTURES) {
    const voiceName = available.get(fixture.culture);
    if (!voiceName) {
      assert(!fixture.required, `No installed SAPI voice for culture ${fixture.culture}.`);
      skipped.push({ id: fixture.id, reason: `no ${fixture.culture} SAPI voice installed` });
      continue;
    }

    process.env.ATHENA_TTS_VOICE = voiceName;
    const synthesized = await voice.synthesize(fixture.text);
    assert.strictEqual(synthesized.ok, true, `${fixture.id}: ${synthesized.error}`);
    const audioPath = synthesized.audioPath;
    assert(audioPath && fs.existsSync(audioPath), `${fixture.id}: synthesized WAV is missing.`);

    // Direct spawn skips preflight, so the gap against transcribe() is the
    // per-utterance overhead that has nothing to do with recognition.
    const direct = runPython(python, [sttScript, audioPath, modelDir], 180_000);
    assert.strictEqual(direct.status, 0, direct.stderr || `${fixture.id}: direct transcription failed.`);

    const service = await timed(() => voice.transcribe(audioPath));
    assert.strictEqual(service.value.ok, true, `${fixture.id}: ${service.value.error}`);
    const text = (service.value.text || '').trim();
    assert(text.length > 0, `${fixture.id}: transcription is empty.`);

    const accuracy = similarity(fixture.text, text, fixture.culture);
    assert(
      accuracy >= fixture.floor,
      `${fixture.id}: accuracy ${round(accuracy * 100)}% fell below the ${round(fixture.floor * 100)}% floor. Got: ${text}`,
    );

    // The gate this suite exists for. transcribe() must do no more work than the
    // direct spawn it wraps; putting a probe back on the hot path costs 300 ms+
    // and lands here as a failure rather than as an unnoticed regression.
    const overheadMs = service.ms - direct.ms;
    assert(
      overheadMs < MAX_HOT_PATH_OVERHEAD_MS,
      `${fixture.id}: transcribe() spent ${round(overheadMs)}ms beyond the direct spawn, over the `
      + `${MAX_HOT_PATH_OVERHEAD_MS}ms budget. A capability probe is back on the hot path.`,
    );

    results.push({
      id: fixture.id,
      voice: voiceName,
      expected: fixture.text,
      actual: text,
      accuracy: Math.round(accuracy * 1000) / 1000,
      directMs: round(direct.ms),
      serviceMs: round(service.ms),
      // transcribe() = preflight + the same work the direct spawn just did.
      overheadMs: round(service.ms - direct.ms),
      decodeMs: round(Math.max(0, direct.ms - loaded.ms)),
    });
    delete process.env.ATHENA_TTS_VOICE;
  }

  assert(results.length > 0, 'No fixture produced a measurement.');

  const report = {
    marker: 'ATHENA_VOICE_INPUT_OK',
    model: path.basename(modelDir),
    phases: {
      preflightMs: round(preflightMs),
      interpreterMs: round(interpreter.ms),
      importMs: round(imported.ms),
      modelLoadMs: round(loaded.ms),
    },
    fixtures: results,
    skipped,
  };

  for (const entry of results) {
    console.log(
      `[${entry.id}] accuracy=${round(entry.accuracy * 100)}% direct=${entry.directMs}ms `
      + `service=${entry.serviceMs}ms overhead=${entry.overheadMs}ms decode=${entry.decodeMs}ms`,
    );
    console.log(`      expected: ${entry.expected}`);
    console.log(`      actual  : ${entry.actual}`);
  }
  for (const entry of skipped) console.log(`[${entry.id}] skipped - ${entry.reason}`);
  console.log(
    `phases preflight=${report.phases.preflightMs}ms interpreter=${report.phases.interpreterMs}ms `
    + `import=${report.phases.importMs}ms modelLoad=${report.phases.modelLoadMs}ms`,
  );
  console.log(JSON.stringify(report));
}

function cleanupVoiceInput() {
  delete process.env.ATHENA_TTS_VOICE;
  delete process.env.ATHENA_CONFIG_DIR;
  delete process.env.ATHENA_DB_DIR;
  delete process.env.ATHENA_VOICE_TEMP_DIR;
  delete process.env.ATHENA_VOICE_SCRIPT_DIR;
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}

main()
  .then(() => { cleanupVoiceInput(); })
  .catch((error) => {
    console.error(`ATHENA_VOICE_INPUT_FAILED ${error?.message || error}`);
    cleanupVoiceInput();
    process.exitCode = 1;
  });
