const assert = require('node:assert/strict');

const { AvatarCanvasController } = require('../dist/renderer/avatar');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeContainer {
  constructor() {
    this.children = [];
  }

  contains(child) {
    return this.children.includes(child);
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
}

class FakeCanvas {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.removed = false;
  }

  remove() {
    this.removed = true;
  }
}

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

function profile() {
  return {
    id: 'athena-canvas-verify',
    displayName: 'Athena Canvas Verify',
    provider: 'gltf',
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: 'G:/Athena/assets/avatar/athena-3d-default',
      modelPath: 'G:/Athena/assets/avatar/athena-3d-default/model/athena-3d-default.glb',
    },
    layout: {
      mode: 'desktop_pet',
      transform: { x: 0, y: 0, scale: 1, opacity: 1, rotationDeg: 0, mirrored: false },
      alwaysOnTop: true,
      clickThroughMode: 'transparentOnly',
      transparentBackground: true,
      lockPosition: false,
    },
    expressions: [{ emotion: 'happy', expressionId: 'happy', intensityScale: 1 }],
    motions: [
      { state: 'idle', motionGroup: 'Idle', priority: 'idle', loop: true },
      { state: 'speaking', motionGroup: 'Speak', priority: 'focused', loop: true },
    ],
    parameters: [],
    lipSync: {
      enabled: true,
      source: 'ttsAudio',
      parameterIds: ['ATH_MOUTH_NEUTRAL'],
      sensitivity: 1,
      smoothing: 0.6,
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
      strength: 0.7,
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
  const canvas = new FakeCanvas();
  const container = new FakeContainer();
  const host = new FakeThreeHost();
  const events = [];
  const controller = new AvatarCanvasController({
    profile: profile(),
    host,
    canvas,
    container,
    className: 'verify-avatar',
    now: () => '2026-08-22T00:00:00.000Z',
    onEvent: event => events.push(event),
  });

  assert.equal(container.children[0], canvas);
  assert.equal(canvas.classList.contains('athena-avatar-canvas'), true);
  assert.equal(canvas.classList.contains('verify-avatar'), true);
  assert.equal(canvas.dataset.avatarProvider, 'gltf');
  assert.equal(canvas.dataset.avatarLayoutMode, 'desktop_pet');

  await controller.load();
  await controller.dispatch({ type: 'emotion.update', emotion: 'happy', intensity: 0.4 });
  await controller.dispatch({ type: 'voice.speaking.start' });
  controller.updateLayoutMode('chat_background');
  assert.equal(controller.getSnapshot().state, 'speaking');
  assert.equal(canvas.dataset.avatarLayoutMode, 'chat_background');
  assert.ok(host.calls.some(call => call.type === 'load'));
  assert.ok(host.calls.some(call => call.type === 'motion' && call.mapping.motionGroup === 'Speak'));
  assert.ok(events.some(event => event.type === 'avatar.expression'));

  await controller.destroy();
  assert.ok(host.calls.some(call => call.type === 'unload'));
  assert.equal(canvas.removed, false);
  console.log('ATHENA_AVATAR_CANVAS_CONTROLLER_OK provider=gltf layout=desktop_pet,chat_background state=speaking host=fake');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
