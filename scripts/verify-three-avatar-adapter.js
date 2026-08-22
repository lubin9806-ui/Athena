const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AvatarRuntime, ThreeAvatarAdapter, resolveThreeAvatarModelSource } = require('../dist/renderer/avatar');

class FakeThreeHost {
  constructor() {
    this.calls = [];
  }

  async load(options) {
    this.calls.push({ type: 'load', options });
  }

  async unload() {
    this.calls.push({ type: 'unload' });
  }

  async setState(state) {
    this.calls.push({ type: 'state', state });
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

function createFixture(extension) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-three-avatar-'));
  const modelPath = path.join(root, `avatar${extension}`);
  fs.writeFileSync(modelPath, extension === '.glb' ? Buffer.alloc(128) : '{}');
  return { root, modelPath };
}

function profile(root, modelPath, provider = 'gltf') {
  return {
    id: `${provider}-verify`,
    displayName: '3D Verify',
    provider,
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: root,
      modelPath,
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
    parameters: [
      { id: 'ATH_MOUTH_NEUTRAL', label: 'Mouth', min: 0, max: 1, defaultValue: 0, favorite: true },
    ],
    lipSync: {
      enabled: true,
      source: 'ttsAudio',
      parameterIds: ['ATH_MOUTH_NEUTRAL'],
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
      headParameterIds: ['ATH_HEAD'],
      eyeParameterIds: ['ATH_EYE_L', 'ATH_EYE_R'],
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
  const fixture = createFixture('.glb');
  const resolved = resolveThreeAvatarModelSource({
    source: 'localDirectory',
    rootPath: fixture.root,
    modelPath: fixture.modelPath,
  }, 'gltf');
  assert.ok(resolved.rootUrl.startsWith('file:///'));
  assert.ok(resolved.modelUrl.endsWith('avatar.glb'));
  assert.equal(resolved.format, 'gltf');

  assert.throws(() => resolveThreeAvatarModelSource({
    source: 'localDirectory',
    rootPath: fixture.root,
    modelPath: path.join(fixture.root, '..', 'outside.glb'),
  }, 'gltf'), /inside/);
  assert.throws(() => resolveThreeAvatarModelSource({
    source: 'localDirectory',
    rootPath: fixture.root,
    modelPath: fixture.modelPath,
  }, 'vrm'), /\.vrm/);

  const host = new FakeThreeHost();
  const adapter = new ThreeAvatarAdapter({ canvas: {}, host });
  const runtime = new AvatarRuntime(adapter, { now: () => '2026-08-22T00:00:00.000Z' });
  await runtime.load(profile(fixture.root, fixture.modelPath));
  assert.equal(runtime.getSnapshot().loaded, true);
  assert.equal(runtime.getSnapshot().provider, 'gltf');
  assert.equal(host.calls[0].type, 'load');
  assert.equal(host.calls[0].options.format, 'gltf');

  await runtime.dispatch({ type: 'emotion.update', emotion: 'happy', intensity: 0.65 });
  assert.deepEqual(host.calls.find(call => call.type === 'expression'), {
    type: 'expression',
    expressionId: 'happy',
    intensity: 0.65,
  });

  await runtime.dispatch({ type: 'voice.speaking.start' });
  assert.equal(runtime.getSnapshot().state, 'speaking');
  assert.equal(runtime.getSnapshot().lipSyncActive, true);
  assert.ok(host.calls.some(call => call.type === 'motion' && call.mapping.motionGroup === 'Speak'));

  await adapter.setParameter('ATH_MOUTH_NEUTRAL', 0.8);
  await runtime.dispatch({ type: 'pointer.move', point: { x: 0.25, y: -0.4 } });
  assert.ok(host.calls.some(call => call.type === 'parameter' && call.parameterId === 'ATH_MOUTH_NEUTRAL' && call.value === 0.8));
  assert.ok(host.calls.some(call => call.type === 'pointer' && call.point.x === 0.25));

  await runtime.unload();
  assert.equal(runtime.getSnapshot().loaded, false);
  assert.ok(host.calls.some(call => call.type === 'unload'));
  console.log('ATHENA_THREE_AVATAR_ADAPTER_OK resolver=file-url providers=gltf,vrm host=fake state=speaking expression=happy parameter=ATH_MOUTH_NEUTRAL');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
