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
const { saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');

/**
 * transcribe() minus the equivalent direct spawn. Measured at ~343 ms while the
 * capability preflight sat on the hot path; noise-level once it was removed.
 */
const MAX_HOT_PATH_OVERHEAD_MS = 150;

/** The language VoiceService passes when the suite runs with default settings. */
const SERVICE_LANGUAGE = 'auto';

/**
 * Enough calls for the background warm-up to finish and the resident path to be
 * exercised; the first ones still go one-shot while the model loads.
 */
const RESIDENT_ATTEMPTS = 5;
/**
 * Interpreter start, import and model construction were ~850ms of a ~1250ms
 * utterance, so keeping the model loaded should take a large bite out of it.
 * The floor is well under the measured saving to leave room for slower disks.
 */
const MIN_RESIDENT_SPEEDUP = 0.25;

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
    // Skipped rather than failed where no English SAPI voice is installed, but
    // gated wherever one is: pinning "zh" for every speaker scored 0% here.
    // The floor sits below the measured 91.7% because "three" comes back as "3"
    // - a number-formatting difference, not a recognition error.
    required: false,
    text: 'Remind me to send the weekly report at three in the afternoon.',
    floor: 0.7,
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

/**
 * Time the same audio with the resident recogniser off and then on.
 *
 * The worker warms in the background, so the first calls with it enabled still
 * take the one-shot path; the run continues until the timings settle, and the
 * fastest of each mode is compared.
 */
async function measureResidentWorker(probe) {
  const withoutWorker = new VoiceService();
  process.env.ATHENA_STT_WORKER = '0';
  let coldMs = Infinity;
  let coldText = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = await timed(() => withoutWorker.transcribe(probe.audioPath));
    assert.strictEqual(run.value.ok, true, `resident/off: ${run.value.error}`);
    if (run.ms < coldMs) coldMs = run.ms;
    coldText = (run.value.text || '').trim();
  }

  delete process.env.ATHENA_STT_WORKER;
  const withWorker = new VoiceService();
  let warmMs = Infinity;
  let warmText = '';
  try {
    for (let attempt = 0; attempt < RESIDENT_ATTEMPTS; attempt += 1) {
      const run = await timed(() => withWorker.transcribe(probe.audioPath));
      assert.strictEqual(run.value.ok, true, `resident/on: ${run.value.error}`);
      warmText = (run.value.text || '').trim();
      // The warming calls are one-shot and would drown the signal, so only runs
      // that beat the one-shot baseline count towards the warm figure.
      if (run.ms < warmMs) warmMs = run.ms;
    }
  } finally {
    withWorker.dispose();
    withoutWorker.dispose();
  }

  const speedup = 1 - warmMs / coldMs;
  assert(
    speedup >= MIN_RESIDENT_SPEEDUP,
    `The resident recogniser never engaged: best ${round(warmMs)}ms against a ${round(coldMs)}ms one-shot `
    + `is ${round(speedup * 100)}%, under the ${round(MIN_RESIDENT_SPEEDUP * 100)}% floor.`,
  );
  assert.strictEqual(
    warmText,
    coldText,
    'The resident recogniser returned different text than the one-shot path for the same audio.',
  );

  console.log(
    `[resident] one-shot ${round(coldMs)}ms -> resident ${round(warmMs)}ms (-${round(speedup * 100)}%), same text`,
  );
  return { coldMs: round(coldMs), warmMs: round(warmMs), speedup: Math.round(speedup * 1000) / 1000 };
}

async function main() {
  assert(fs.existsSync(RUNTIME), `Managed voice runtime is missing at ${RUNTIME}. Run npm.cmd run prepare:voice-runtime.`);
  // The hot-path budget compares transcribe() against an equivalent one-shot
  // spawn, so the resident recogniser stays off until it is measured on its own.
  // Leaving it on made transcribe() ~850ms faster than the spawn it is compared
  // with, which would have hidden a probe put back on the hot path.
  process.env.ATHENA_STT_WORKER = '0';
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

    // What a pinned language code costs and buys, measured rather than assumed.
    // Every speaker used to be decoded as "zh"; the matrix keeps that comparison
    // visible so the default stays an argued choice.
    const modes = [...new Set(['auto', fixture.culture, 'zh'])];
    const byMode = {};
    for (const mode of modes) {
      // Scheduling noise on a busy machine is additive, so the fastest of a few
      // identical runs is the honest estimate of what the work costs. The
      // service language gets the extra sample because a budget is asserted on it.
      const attempts = mode === SERVICE_LANGUAGE ? 2 : 1;
      let best = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const run = runPython(python, [sttScript, audioPath, modelDir, mode], 180_000);
        assert.strictEqual(run.status, 0, run.stderr || `${fixture.id}/${mode}: transcription failed.`);
        if (!best || run.ms < best.ms) best = run;
      }
      byMode[mode] = {
        text: best.stdout,
        accuracy: Math.round(similarity(fixture.text, best.stdout, fixture.culture) * 1000) / 1000,
        ms: round(best.ms),
      };
    }

    // The direct spawn to compare transcribe() against must do the same work it
    // does, so it uses the same language the service will pass.
    const direct = byMode[SERVICE_LANGUAGE];
    assert(direct, `${fixture.id}: no measurement for the service language ${SERVICE_LANGUAGE}.`);

    let service = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = await timed(() => voice.transcribe(audioPath));
      assert.strictEqual(run.value.ok, true, `${fixture.id}: ${run.value.error}`);
      if (!service || run.ms < service.ms) service = run;
    }
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
      culture: fixture.culture,
      audioPath,
      voice: voiceName,
      expected: fixture.text,
      actual: text,
      accuracy: Math.round(accuracy * 1000) / 1000,
      directMs: direct.ms,
      serviceMs: round(service.ms),
      // transcribe() should do no more work than the direct spawn it wraps.
      overheadMs: round(service.ms - direct.ms),
      decodeMs: round(Math.max(0, direct.ms - loaded.ms)),
      languages: byMode,
    });
    delete process.env.ATHENA_TTS_VOICE;
  }

  assert(results.length > 0, 'No fixture produced a measurement.');

  // A settings control that does not reach the sidecar is the defect this
  // suite's sibling entries are about, so prove the wiring rather than the
  // parameter. Pinning the wrong language is the visible proof: the same audio
  // comes back materially worse, which cannot happen if the value was dropped.
  const probe = results[0];
  const wrongLanguage = probe.culture === 'zh' ? 'en' : 'zh';
  saveSettingsBundle({ settings: { voice: { sttLanguage: wrongLanguage } } });
  const pinned = await voice.transcribe(probe.audioPath);
  saveSettingsBundle({ settings: { voice: { sttLanguage: 'auto' } } });
  assert.strictEqual(pinned.ok, true, `settings probe: ${pinned.error}`);
  const pinnedAccuracy = similarity(probe.expected, (pinned.text || '').trim(), probe.culture);
  assert(
    pinnedAccuracy < probe.accuracy,
    `voice.sttLanguage never reached the sidecar: pinning "${wrongLanguage}" on the ${probe.id} fixture still `
    + `scored ${round(pinnedAccuracy * 100)}% against ${round(probe.accuracy * 100)}% on auto.`,
  );
  console.log(
    `[settings] sttLanguage="${wrongLanguage}" on the ${probe.id} fixture drops accuracy `
    + `${round(probe.accuracy * 100)}% -> ${round(pinnedAccuracy * 100)}%, so the control reaches the sidecar`,
  );

  // The resident recogniser keeps the model loaded between utterances. Compare
  // the two paths on the same audio: it has to be faster, and it has to return
  // the same words - a faster answer that says something else is not the answer.
  const resident = await measureResidentWorker(probe);

  const report = {
    marker: 'ATHENA_VOICE_INPUT_OK',
    resident,
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
    for (const [mode, run] of Object.entries(entry.languages)) {
      console.log(`      lang=${mode.padEnd(4)} accuracy=${round(run.accuracy * 100)}% ${run.ms}ms :: ${run.text}`);
    }
  }
  for (const entry of skipped) console.log(`[${entry.id}] skipped - ${entry.reason}`);
  console.log(
    `phases preflight=${report.phases.preflightMs}ms interpreter=${report.phases.interpreterMs}ms `
    + `import=${report.phases.importMs}ms modelLoad=${report.phases.modelLoadMs}ms`,
  );
  console.log(JSON.stringify(report));
}

function cleanupVoiceInput() {
  delete process.env.ATHENA_STT_WORKER;
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
