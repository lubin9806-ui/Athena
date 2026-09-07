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

  console.log('ATHENA_VOICE_ACTIVITY_OK');
}

try {
  main();
} catch (error) {
  console.error(`ATHENA_VOICE_ACTIVITY_FAILED ${error?.message || error}`);
  process.exitCode = 1;
}
