const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

class FakeLive2DHost {
  constructor() {
    this.calls = [];
  }
  async load(options) { this.calls.push({ type: 'load', options }); }
  async unload() { this.calls.push({ type: 'unload' }); }
  async setExpression(expressionId, intensity) { this.calls.push({ type: 'expression', expressionId, intensity }); }
  async playMotion(mapping) { this.calls.push({ type: 'motion', mapping }); }
  async setParameter(parameterId, value) { this.calls.push({ type: 'parameter', parameterId, value }); }
  async updatePointer(point) { this.calls.push({ type: 'pointer', point }); }
}

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const model = readJson(path.join(PACKAGE_ROOT, manifest.runtime.model3Json));
  const profile = readJson(path.join(PACKAGE_ROOT, manifest.runtime.profile));
  const definition = model.AthenaLive2DLite;

  assert.equal(model.Version, 3);
  assert.equal(definition.schemaVersion, 1);
  assert.ok(definition.layers.length >= 35, 'expected a substantial layered model');
  for (const expression of ['neutral', 'happy', 'shy', 'sleepy', 'playful']) {
    assert.ok(definition.expressions[expression], `missing expression: ${expression}`);
  }
  for (const parameter of ['ParamAngleX', 'ParamEyeBallX', 'ParamMouthOpenY', 'ParamHairSwing']) {
    assert.ok(definition.parameters[parameter], `missing parameter: ${parameter}`);
  }
  for (const motion of ['Idle', 'Speak', 'TouchHead', 'TouchHairClip']) {
    assert.ok(definition.motionGroups[motion], `missing motion group: ${motion}`);
  }
  for (const hitArea of ['Head', 'HairClip', 'Face', 'Hand']) {
    assert.ok(definition.hitAreas.some(area => area.name === hitArea), `missing hit area: ${hitArea}`);
  }

  profile.model.rootPath = PACKAGE_ROOT;
  profile.model.model3JsonPath = path.join(PACKAGE_ROOT, manifest.runtime.model3Json);
  const { AvatarRuntime, Live2DAvatarAdapter } = require('../dist/renderer/avatar');
  const host = new FakeLive2DHost();
  const runtime = new AvatarRuntime(new Live2DAvatarAdapter({ canvas: {}, host }), {
    now: () => '2026-08-22T00:00:00.000Z',
  });
  await runtime.load(profile);
  await runtime.dispatch({ type: 'emotion.update', emotion: 'shy', intensity: 0.8 });
  await runtime.dispatch({ type: 'voice.speaking.start' });
  const action = await runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: 'hair_clip' });

  assert.equal(runtime.getSnapshot().state, 'speaking');
  assert.ok(host.calls.some(call => call.type === 'expression' && call.expressionId === 'shy'));
  assert.ok(host.calls.some(call => call.type === 'motion' && call.mapping.motionGroup === 'Speak'));
  assert.equal(action.type, 'composite');
  assert.ok(action.actions.some(item => item.type === 'athenaReply'));

  await runtime.unload();
  console.log(`ATHENA_LIVE2D_LITE_PACKAGE_OK layers=${definition.layers.length} expressions=${Object.keys(definition.expressions).length} motions=${Object.keys(definition.motionGroups).length} hitAreas=${definition.hitAreas.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
