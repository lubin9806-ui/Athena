const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  AvatarRealtimeLipSyncController,
  StaticAudioLevelSource,
} = require('../dist/renderer/avatar');
const {
  applyAvatarProfileCustomization,
  readAvatarProfileCustomization,
} = require('../dist/renderer/avatar/live2d/AvatarProfileCustomization');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

async function flushMicrotasks() {
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const profile = readJson('assets/avatar/athena-live2d-default/profile.avatar.json');
  const source = new StaticAudioLevelSource(0.8);
  const writes = [];
  const frames = new Map();
  let nextFrame = 1;
  let time = 0;
  const values = [];
  const realtime = new AvatarRealtimeLipSyncController({
    settings: { ...profile.lipSync, smoothing: 0, attackMs: 1, releaseMs: 1 },
    adapter: {
      async setParameter(parameterId, value) {
        writes.push({ parameterId, value });
      },
    },
    audioSource: source,
    now: () => time,
    scheduler: {
      request(callback) {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancel(handle) {
        frames.delete(handle);
      },
    },
    onValue: value => values.push(value),
  });

  realtime.start();
  assert.equal(realtime.isRunning, true);
  assert.equal(frames.size, 1);
  const first = [...frames.entries()][0];
  frames.delete(first[0]);
  time += 16;
  first[1](time);
  await flushMicrotasks();
  assert.ok(realtime.value > 0.6, `expected realtime mouth opening, got ${realtime.value}`);
  assert.ok(values.at(-1) > 0.6);
  assert.equal(frames.size, 1, 'the realtime loop must schedule the next frame');

  realtime.updateSettings({ ...profile.lipSync, gain: 2, sensitivity: 1.5 });
  await realtime.stop();
  assert.equal(realtime.isRunning, false);
  assert.equal(realtime.value, 0);
  assert.equal(frames.size, 0);
  assert.deepEqual(writes.at(-1), { parameterId: 'ParamMouthOpenY', value: 0 });

  const customized = applyAvatarProfileCustomization(profile, {
    version: 1,
    layout: { mode: 'chat_right', transform: { scale: 1.25 } },
    lipSync: { sensitivity: 1.7, gain: 1.4 },
    emotionBindings: { happy: { expressionId: 'playful', intensityScale: 0.6 } },
  });
  assert.equal(customized.layout.mode, 'chat_right');
  assert.equal(customized.layout.transform.scale, 1.25);
  assert.equal(customized.lipSync.sensitivity, 1.7);
  assert.equal(customized.expressions.find(item => item.emotion === 'happy').expressionId, 'playful');
  assert.equal(profile.expressions.find(item => item.emotion === 'happy').expressionId, 'happy', 'source profile must remain immutable');
  assert.deepEqual(readAvatarProfileCustomization('{bad json'), { version: 1 });

  const manifest = readJson('assets/avatar/athena-live2d-default/manifest.json');
  assert.equal(manifest.runtime.realtimeLipSync, true);
  assert.equal(manifest.runtime.customEmotionBindings, true);
  assert.equal(manifest.runtime.profileCustomization, 'local-v1');

  const preview = fs.readFileSync(path.join(ROOT, 'src/renderer/avatar/live2d/preview.ts'), 'utf8');
  for (const contract of ['WebAudioAnalyserLevelSource', 'voice.speaking.start', 'emotion.update', 'localStorage']) {
    assert.ok(preview.includes(contract), `preview missing realtime contract: ${contract}`);
  }

  console.log(`ATHENA_LIVE2D_REALTIME_OK frames=${values.length} reset=verified emotionBindings=${customized.expressions.length} customization=local-v1`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
