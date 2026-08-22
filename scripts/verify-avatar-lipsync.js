const assert = require('node:assert/strict');

const {
  AvatarLipSyncController,
  StaticAudioLevelSource,
} = require('../dist/renderer/avatar');

function settings() {
  return {
    enabled: true,
    source: 'ttsAudio',
    parameterIds: ['ParamMouthOpenY', 'ParamMouthForm'],
    sensitivity: 1,
    smoothing: 0,
    gain: 1,
    attackMs: 1,
    releaseMs: 1,
    minValue: 0,
    maxValue: 1,
  };
}

async function main() {
  let time = 0;
  const source = new StaticAudioLevelSource(0);
  const writes = [];
  const adapter = {
    async setParameter(parameterId, value) {
      writes.push({ parameterId, value });
    },
  };
  const controller = new AvatarLipSyncController({
    settings: settings(),
    adapter,
    audioSource: source,
    now: () => time,
  });

  assert.equal(controller.isRunning, false);
  controller.start();
  assert.equal(controller.isRunning, true);

  source.setLevel(0.8);
  time += 16;
  const open = await controller.tick();
  assert.ok(open > 0.6, `expected mouth to open, got ${open}`);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.value === open));

  source.setLevel(0);
  time += 16;
  const closed = await controller.tick();
  assert.ok(closed < open, `expected mouth to close from ${open}, got ${closed}`);

  controller.stop();
  assert.equal(controller.value, 0);
  assert.equal(controller.isRunning, false);
  const writeCount = writes.length;
  time += 16;
  await controller.tick();
  assert.equal(writes.length, writeCount);

  console.log('ATHENA_AVATAR_LIPSYNC_OK source=static parameters=2 open-close=verified');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

