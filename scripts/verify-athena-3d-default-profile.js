const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadAvatarCharacterProfile, validateAvatarProfile } = require('../dist/core/avatar');
const { AvatarRuntime, ThreeAvatarAdapter } = require('../dist/renderer/avatar');

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

async function main() {
  const root = path.resolve(__dirname, '..');
  const profilePath = path.join(root, 'assets', 'avatar', 'athena-3d-default', 'profile.avatar.json');
  const profile = loadAvatarCharacterProfile(profilePath);
  const validation = validateAvatarProfile(profile);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2));
  assert.equal(profile.provider, 'gltf');
  assert.ok(path.isAbsolute(profile.model.rootPath));
  assert.ok(path.isAbsolute(profile.model.modelPath));
  assert.ok(fs.existsSync(profile.model.modelPath), `missing model: ${profile.model.modelPath}`);
  assert.ok(profile.expressions.length >= 9);
  assert.ok(profile.motions.length >= 9);
  assert.ok(profile.hotZones.length >= 5);

  const host = new FakeThreeHost();
  const runtime = new AvatarRuntime(new ThreeAvatarAdapter({ canvas: {}, host }), {
    now: () => '2026-08-22T00:00:00.000Z',
  });
  await runtime.load(profile);
  await runtime.dispatch({ type: 'emotion.update', emotion: 'happy', intensity: 0.7 });
  await runtime.dispatch({ type: 'voice.speaking.start' });
  const action = await runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: 'hair_clip' });
  assert.equal(action.type, 'composite');
  assert.equal(runtime.getSnapshot().state, 'speaking');
  assert.equal(runtime.getSnapshot().expressionId, 'happy');
  assert.ok(host.calls.some(call => call.type === 'load' && call.options.format === 'gltf'));
  assert.ok(host.calls.some(call => call.type === 'motion' && call.mapping.motionGroup === 'Speak'));
  console.log('ATHENA_3D_DEFAULT_PROFILE_OK provider=gltf expressions=9 motions=9 hotZones=5 paths=resolved runtime=loaded');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
