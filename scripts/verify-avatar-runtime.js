const assert = require('node:assert/strict');

const { AvatarRuntime, MockAvatarAdapter } = require('../dist/renderer/avatar');

function profile() {
  return {
    id: 'verify-avatar',
    displayName: 'Verify Avatar',
    provider: 'mock',
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: 'G:/Athena/fixtures/avatar/verify',
    },
    layout: {
      mode: 'draggable_overlay',
      transform: { x: 0, y: 0, scale: 1, opacity: 1, rotationDeg: 0, mirrored: false },
      alwaysOnTop: false,
      clickThroughMode: 'off',
      transparentBackground: true,
      lockPosition: false,
    },
    expressions: [
      { emotion: 'happy', expressionId: 'happy.exp3.json', intensityScale: 1 },
      { emotion: 'thoughtful', expressionId: 'think.exp3.json', intensityScale: 0.8 },
    ],
    motions: [
      { state: 'idle', motionGroup: 'Idle', priority: 'idle', loop: true },
      { state: 'listening', motionGroup: 'Listen', priority: 'focused', loop: true },
      { state: 'thinking', motionGroup: 'Think', priority: 'focused', loop: true },
      { state: 'speaking', motionGroup: 'Speak', priority: 'focused', loop: true },
    ],
    parameters: [],
    lipSync: {
      enabled: true,
      source: 'ttsAudio',
      parameterIds: ['ParamMouthOpenY'],
      sensitivity: 1,
      smoothing: 0.65,
      gain: 1,
      attackMs: 35,
      releaseMs: 120,
      minValue: 0,
      maxValue: 1,
    },
    pointerTracking: {
      enabled: true,
      headParameterIds: ['ParamAngleX', 'ParamAngleY'],
      eyeParameterIds: ['ParamEyeBallX', 'ParamEyeBallY'],
      strength: 0.75,
      smoothing: 0.5,
    },
    idle: {
      enabled: true,
      idleDelayMs: 30000,
      sleepyDelayMs: 300000,
      awayDelayMs: 900000,
      motionGroups: ['Idle'],
      randomize: true,
    },
    hotZones: [
      {
        id: 'head',
        label: 'Head',
        hitAreaName: 'Head',
        action: {
          type: 'athenaReply',
          promptTemplate: 'The user touched the avatar head. Reply naturally as Athena.',
        },
        cooldownMs: 1200,
        enabled: true,
      },
    ],
    externalControl: {
      transport: 'disabled',
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      requireToken: true,
      allowedCommandTypes: [],
      auditEnabled: true,
    },
  };
}

async function main() {
  const adapter = new MockAvatarAdapter();
  const runtime = new AvatarRuntime(adapter, { now: () => '2026-08-22T00:00:00.000Z' });
  const events = [];
  runtime.subscribe(event => events.push(event));

  await runtime.load(profile());
  assert.equal(runtime.getSnapshot().state, 'idle');

  await runtime.dispatch({ type: 'voice.listening.start' });
  assert.equal(runtime.getSnapshot().state, 'listening');
  assert.equal(runtime.getSnapshot().motionGroup, 'Listen');

  await runtime.dispatch({ type: 'chat.thinking.start' });
  assert.equal(runtime.getSnapshot().state, 'thinking');
  assert.equal(runtime.getSnapshot().motionGroup, 'Think');

  await runtime.dispatch({ type: 'emotion.update', emotion: 'happy', intensity: 0.9 });
  assert.equal(runtime.getSnapshot().expressionId, 'happy.exp3.json');

  await runtime.dispatch({ type: 'voice.speaking.start' });
  assert.equal(runtime.getSnapshot().state, 'speaking');
  assert.equal(runtime.getSnapshot().lipSyncActive, true);

  const action = await runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: 'head' });
  assert.equal(action.type, 'athenaReply');

  await runtime.dispatch({ type: 'voice.speaking.end' });
  assert.equal(runtime.getSnapshot().state, 'idle');
  assert.equal(runtime.getSnapshot().lipSyncActive, false);

  assert.ok(events.some(event => event.type === 'avatar.load'));
  assert.ok(events.some(event => event.type === 'avatar.expression'));
  assert.ok(events.some(event => event.type === 'avatar.hotZone'));
  console.log('ATHENA_AVATAR_RUNTIME_OK states=idle,listening,thinking,speaking emotion=happy hotZone=head adapter=mock');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

