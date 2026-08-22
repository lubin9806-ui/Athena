const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AvatarRuntime, Live2DAvatarAdapter, resolveLive2DModelSource } = require('../dist/renderer/avatar');

class FakeLive2DHost {
  constructor() {
    this.calls = [];
  }

  async load(options) {
    this.calls.push({ type: 'load', options });
  }

  async unload() {
    this.calls.push({ type: 'unload' });
  }

  async setExpression(expressionId, intensity) {
    this.calls.push({ type: 'expression', expressionId, intensity });
  }

  async playMotion(mapping) {
    this.calls.push({ type: 'motion', mapping });
  }

  async setParameter(parameterId, value) {
    this.calls.push({ type: 'parameter', parameterId, value });
  }

  async updatePointer(point) {
    this.calls.push({ type: 'pointer', point });
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-live2d-adapter-'));
  const modelPath = path.join(root, 'avatar.model3.json');
  fs.writeFileSync(modelPath, JSON.stringify({ Version: 3, FileReferences: { Textures: [], Motions: {} } }));
  return { root, modelPath };
}

function profile(root, modelPath) {
  return {
    id: 'live2d-verify',
    displayName: 'Live2D Verify',
    provider: 'live2d',
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: root,
      model3JsonPath: modelPath,
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
      { emotion: 'happy', expressionId: 'happy', intensityScale: 1 },
    ],
    motions: [
      { state: 'idle', motionGroup: 'Idle', priority: 'idle', loop: true },
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
    hotZones: [],
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
  const fixture = createFixture();
  const resolved = resolveLive2DModelSource({
    source: 'localDirectory',
    rootPath: fixture.root,
    model3JsonPath: fixture.modelPath,
  });
  assert.ok(resolved.rootUrl.startsWith('file:///'));
  assert.ok(resolved.modelUrl.endsWith('avatar.model3.json'));

  assert.throws(() => resolveLive2DModelSource({
    source: 'localDirectory',
    rootPath: fixture.root,
    model3JsonPath: path.join(fixture.root, '..', 'outside.model3.json'),
  }), /inside/);

  const host = new FakeLive2DHost();
  const adapter = new Live2DAvatarAdapter({ canvas: {}, host });
  const runtime = new AvatarRuntime(adapter, { now: () => '2026-08-22T00:00:00.000Z' });
  await runtime.load(profile(fixture.root, fixture.modelPath));
  assert.equal(runtime.getSnapshot().loaded, true);
  assert.equal(runtime.getSnapshot().state, 'idle');
  assert.equal(host.calls[0].type, 'load');
  assert.ok(host.calls[0].options.modelUrl.startsWith('file:///'));

  await runtime.dispatch({ type: 'emotion.update', emotion: 'happy', intensity: 0.5 });
  assert.equal(runtime.getSnapshot().expressionId, 'happy');
  assert.deepEqual(host.calls.find(call => call.type === 'expression'), {
    type: 'expression',
    expressionId: 'happy',
    intensity: 0.5,
  });

  await runtime.dispatch({ type: 'voice.speaking.start' });
  assert.equal(runtime.getSnapshot().state, 'speaking');
  assert.equal(runtime.getSnapshot().lipSyncActive, true);
  assert.ok(host.calls.some(call => call.type === 'motion' && call.mapping.motionGroup === 'Speak'));

  await adapter.setParameter('ParamMouthOpenY', 0.7);
  assert.ok(host.calls.some(call => call.type === 'parameter' && call.parameterId === 'ParamMouthOpenY' && call.value === 0.7));

  await runtime.unload();
  assert.equal(runtime.getSnapshot().loaded, false);
  assert.ok(host.calls.some(call => call.type === 'unload'));
  console.log('ATHENA_LIVE2D_ADAPTER_OK resolver=file-url escapes=rejected host=fake state=speaking expression=happy parameter=ParamMouthOpenY');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

