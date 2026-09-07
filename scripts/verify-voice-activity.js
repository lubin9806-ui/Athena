/**
 * Drive the endpoint detector with recorded-shaped loudness sequences.
 *
 * This is the part of voice input most likely to be wrong and least likely to be
 * caught by a microphone test: whether a run of readings is someone talking. The
 * detector is pure, so the room can be described instead of arranged - a fan, a
 * quiet study, a door closing, a person who starts before the calibration ends.
 */
const assert = require('assert');

const {
  SpeechActivityDetector,
  RECORDING_ACTIVITY_OPTIONS,
} = require('../dist/renderer/voice/SpeechActivityDetector.js');
const { BARGE_IN_ACTIVITY_OPTIONS } = require('../dist/renderer/voice/BargeInMonitor.js');
const {
  voiceSessionState,
  voiceSessionPulse,
} = require('../dist/renderer/voice/VoiceSession.js');

/** The rule this detector replaced: any two consecutive frames over 0.008. */
const OLD_FIXED_THRESHOLD = 0.008;

function oldRuleFires(levels) {
  let run = 0;
  for (const level of levels) {
    run = level >= OLD_FIXED_THRESHOLD ? run + 1 : 0;
    if (run >= 2) return true;
  }
  return false;
}

function detector() {
  return new SpeechActivityDetector(RECORDING_ACTIVITY_OPTIONS);
}

function bargeInDetector() {
  return new SpeechActivityDetector(BARGE_IN_ACTIVITY_OPTIONS);
}

function feed(instance, levels) {
  return levels.map(level => instance.push(level));
}

function steady(level, frames) {
  return new Array(frames).fill(level);
}

/** Room noise wanders; a constant would be an unfairly easy test. */
function noisy(level, frames, jitter = 0.2) {
  return Array.from({ length: frames }, (_unused, index) => {
    const wobble = Math.sin(index * 1.7) * jitter;
    return Math.max(0, level * (1 + wobble));
  });
}

function check(name, run) {
  run();
  console.log(`  ok  ${name}`);
}

function main() {
  check('a quiet room then speech is heard', () => {
    const instance = detector();
    feed(instance, steady(0.002, 8));
    assert.strictEqual(instance.hasHeardSpeech, false, 'silence was reported as speech');
    const states = feed(instance, steady(0.06, 6));
    assert(states.includes('speech'), 'speech after silence was not heard');
  });

  check('a noisy room is not mistaken for speech', () => {
    const room = noisy(0.02, 60);
    const instance = detector();
    feed(instance, room);
    assert.strictEqual(
      instance.hasHeardSpeech,
      false,
      `steady room noise around 0.02 was reported as speech (floor measured ${instance.noiseFloor.toFixed(4)}, `
      + `threshold ${instance.threshold.toFixed(4)})`,
    );
    // The point of the change: this room used to make every frame "speech",
    // which is why the pause that ends a recording never arrived.
    assert.strictEqual(oldRuleFires(room), true, 'the fixture no longer reproduces the defect it exists for');
  });

  check('speech still carries over noisy room tone', () => {
    const instance = detector();
    feed(instance, noisy(0.02, 40));
    const states = feed(instance, noisy(0.12, 8));
    assert(states.includes('speech'), 'a raised voice over room noise was not heard');
  });

  check('a single loud frame is not speech', () => {
    const instance = detector();
    feed(instance, steady(0.002, 8));
    feed(instance, [0.4]);
    assert.strictEqual(instance.hasHeardSpeech, false, 'one loud frame was treated as speech');
    feed(instance, steady(0.002, 4));
    assert.strictEqual(instance.hasHeardSpeech, false, 'a click still counted after it passed');
  });

  check('a pause after speech releases', () => {
    const instance = detector();
    feed(instance, steady(0.002, 8));
    let states = feed(instance, steady(0.06, 6));
    assert.strictEqual(states[states.length - 1], 'speech', 'speech did not register');
    states = feed(instance, steady(0.002, RECORDING_ACTIVITY_OPTIONS.releaseFrames + 2));
    assert.strictEqual(states[states.length - 1], 'quiet', 'the pause after speech never released');
    assert.strictEqual(instance.hasHeardSpeech, true, 'the recording forgot that speech happened');
  });

  check('someone talking through calibration is heard once it ends', () => {
    // Speech has gaps between syllables and the floor is taken from the quietest
    // frame, so a talker during calibration does not set the bar to their voice.
    const instance = detector();
    feed(instance, [0.12, 0.02, 0.14, 0.03, 0.11, 0.02]);
    const states = feed(instance, steady(0.12, 4));
    assert(states.includes('speech'), 'speech continuing past calibration was missed');
  });

  check('speech that never pauses re-measures the room', () => {
    // A room louder than the cap allows would otherwise leave the detector
    // permanently convinced someone is talking, which is the original defect.
    const instance = detector();
    feed(instance, steady(0.001, RECORDING_ACTIVITY_OPTIONS.calibrationFrames));
    const stuck = feed(instance, steady(0.06, RECORDING_ACTIVITY_OPTIONS.maxSpeechFrames + 2));
    assert(stuck.includes('calibrating'), 'unbroken speech never triggered a re-measurement');

    // The second measurement is allowed above the cap, so the loud room finally
    // reads as quiet rather than as endless speech.
    const settled = feed(instance, steady(0.06, RECORDING_ACTIVITY_OPTIONS.calibrationFrames + 4));
    assert.strictEqual(
      settled[settled.length - 1],
      'quiet',
      `the re-measurement did not settle: floor ${instance.noiseFloor.toFixed(4)}, threshold ${instance.threshold.toFixed(4)}`,
    );
  });

  check('a very quiet room does not lower the bar below the old rule', () => {
    const instance = detector();
    feed(instance, steady(0.0001, 8));
    assert(
      instance.threshold >= OLD_FIXED_THRESHOLD,
      `threshold ${instance.threshold} fell under the ${OLD_FIXED_THRESHOLD} lower bound in a silent room`,
    );
  });

  check('a uniformly loud calibration cannot deafen the detector', () => {
    // The worst case for the floor: every calibration frame loud, no gaps for
    // the minimum to find. The cap is what keeps this recoverable.
    const instance = detector();
    feed(instance, steady(0.5, RECORDING_ACTIVITY_OPTIONS.calibrationFrames));
    assert(
      instance.noiseFloor <= RECORDING_ACTIVITY_OPTIONS.maximumFloor,
      `floor ${instance.noiseFloor} exceeded the ${RECORDING_ACTIVITY_OPTIONS.maximumFloor} cap`,
    );
    const states = feed(instance, steady(0.2, 6));
    assert(states.includes('speech'), 'speech after a loud calibration was ignored');
  });

  // Barge-in listens while Athena is speaking, so the first thing it must not do
  // is hear Athena. These cover the decision; whether the browser's echo
  // canceller leaves a residue this quiet is a real-hardware question.
  check('the reading does not interrupt itself', () => {
    const instance = bargeInDetector();
    feed(instance, noisy(0.03, 60, 0.15));
    assert.strictEqual(
      instance.hasHeardSpeech,
      false,
      `residual echo was taken for a speaker (floor ${instance.noiseFloor.toFixed(4)}, `
      + `threshold ${instance.threshold.toFixed(4)})`,
    );
  });

  check('a person speaking over the reading interrupts it', () => {
    const instance = bargeInDetector();
    feed(instance, noisy(0.03, 20, 0.15));
    const states = feed(instance, noisy(0.25, 8, 0.1));
    assert(states.includes('speech'), 'speaking over the reading did not interrupt it');
  });

  check('a short noise over the reading does not interrupt it', () => {
    // Cutting Athena off mid-sentence because a chair moved is worse than having
    // to press the button, so onset is longer here than for dictation.
    const instance = bargeInDetector();
    feed(instance, noisy(0.03, 20, 0.15));
    feed(instance, [0.4, 0.35]);
    assert.strictEqual(instance.hasHeardSpeech, false, 'a short noise stopped the reading');
  });

  check('interrupting asks for more evidence than dictation', () => {
    const stricter = ['minimumLevel', 'floorMultiplier', 'onsetFrames'];
    for (const key of stricter) {
      assert(
        BARGE_IN_ACTIVITY_OPTIONS[key] > RECORDING_ACTIVITY_OPTIONS[key],
        `barge-in ${key} (${BARGE_IN_ACTIVITY_OPTIONS[key]}) is not stricter than dictation `
        + `(${RECORDING_ACTIVITY_OPTIONS[key]}); a false interrupt costs more than a missed one`,
      );
    }
  });

  // The voice surface derives its state instead of tracking one, so what is
  // worth testing is that the derivation cannot claim to be listening when
  // nothing is open, or idle in the gap between turns.
  const session = (patch = {}) => voiceSessionState({
    open: true,
    recording: false,
    transcribing: false,
    streaming: false,
    speaking: false,
    ...patch,
  });

  check('a closed surface is idle whatever else is happening', () => {
    const state = voiceSessionState({
      open: false, recording: true, transcribing: true, streaming: true, speaking: true,
    });
    assert.strictEqual(state, 'idle', 'a closed surface reported activity');
  });

  check('the surface names what is actually happening', () => {
    assert.strictEqual(session({ recording: true }), 'listening');
    assert.strictEqual(session({ transcribing: true }), 'thinking');
    assert.strictEqual(session({ streaming: true }), 'thinking');
    assert.strictEqual(session({ speaking: true }), 'speaking');
  });

  check('the line stays open between turns', () => {
    // Nothing is recording, generating or playing - the gap after a reply. Idle
    // here would make a continuous conversation look like it had stopped.
    assert.strictEqual(session(), 'listening', 'the gap between turns read as idle');
  });

  check('recording wins over a reply that is still finishing', () => {
    // Barge-in starts a recording while audio is still unwinding; the surface
    // must say it is listening, because it is.
    assert.strictEqual(session({ recording: true, speaking: true }), 'listening');
  });

  check('the pulse stays inside its range and follows the microphone', () => {
    const quiet = voiceSessionPulse('listening', 0, 0);
    const loud = voiceSessionPulse('listening', 0.5, 0);
    assert(loud > quiet, 'a louder microphone did not pulse harder');
    for (const state of ['listening', 'thinking', 'speaking', 'idle']) {
      for (const elapsed of [0, 130, 400, 900, 2600]) {
        for (const level of [0, 0.3, 5]) {
          const pulse = voiceSessionPulse(state, level, elapsed);
          assert(
            pulse >= 0 && pulse <= 1,
            `${state} pulsed to ${pulse} at ${elapsed}ms and level ${level}, outside 0..1`,
          );
        }
      }
    }
  });

  console.log('ATHENA_VOICE_ACTIVITY_OK');
}

try {
  main();
} catch (error) {
  console.error(`ATHENA_VOICE_ACTIVITY_FAILED ${error?.message || error}`);
  process.exitCode = 1;
}
