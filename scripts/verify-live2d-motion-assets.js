const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');
const MODEL_ROOT = path.join(PACKAGE_ROOT, 'model');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const runtimeModel = readJson(path.join(MODEL_ROOT, 'athena-live2d-default-sdk5.model3.json'));
  const sourceModel = readJson(path.join(MODEL_ROOT, 'athena-live2d-default.model3.json'));
  const displayInfo = readJson(path.join(MODEL_ROOT, 'athena-live2d-default-sdk5.cdi3.json'));
  const parameterIds = new Set(displayInfo.Parameters.map(parameter => parameter.Id));
  const requiredGroups = manifest.riggingTargets.requiredMotionGroups;

  assert.ok([
    'cubism_native_expressions_validated',
    'athena_app_integration_validated',
    'desktop_pet_window_validated',
  ].includes(manifest.status));
  assert.equal(manifest.production.physicsReady, true);
  assert.equal(manifest.production.motionsReady, true);
  assert.equal(manifest.production.independentArmMotionReady, false);
  assert.equal(profile.model.packageVersion, manifest.version);
  assert.equal(requiredGroups.length, 12);
  assert.deepEqual(Object.keys(runtimeModel.FileReferences.Motions), requiredGroups);
  assert.deepEqual(Object.keys(sourceModel.FileReferences.Motions), requiredGroups);
  assert.equal(runtimeModel.FileReferences.Physics, 'athena-live2d-default.physics3.json');
  assert.equal(sourceModel.FileReferences.Physics, runtimeModel.FileReferences.Physics);

  let curveCount = 0;
  for (const group of requiredGroups) {
    const entries = runtimeModel.FileReferences.Motions[group];
    assert.equal(entries.length, 1, `${group} must have one deterministic default motion`);
    const motionPath = path.join(MODEL_ROOT, entries[0].File);
    const document = readJson(motionPath);
    assert.equal(document.Version, 3);
    assert.ok(document.Meta.Duration >= 1);
    assert.equal(document.Meta.Fps, 60);
    assert.equal(document.Meta.CurveCount, document.Curves.length);
    assert.equal(document.Meta.TotalSegmentCount, document.Curves.reduce((total, curve) => total + ((curve.Segments.length - 2) / 3), 0));
    assert.equal(document.Meta.TotalPointCount, document.Curves.reduce((total, curve) => total + 1 + ((curve.Segments.length - 2) / 3), 0));
    for (const curve of document.Curves) {
      assert.equal(curve.Target, 'Parameter');
      assert.ok(parameterIds.has(curve.Id), `${group} references missing parameter ${curve.Id}`);
      assert.equal((curve.Segments.length - 2) % 3, 0, `${group}/${curve.Id} has malformed linear segments`);
      curveCount += 1;
    }
  }

  const physics = readJson(path.join(MODEL_ROOT, runtimeModel.FileReferences.Physics));
  assert.equal(physics.Version, 3);
  assert.equal(physics.Meta.PhysicsSettingCount, physics.PhysicsSettings.length);
  assert.equal(physics.Meta.TotalInputCount, physics.PhysicsSettings.reduce((total, setting) => total + setting.Input.length, 0));
  assert.equal(physics.Meta.TotalOutputCount, physics.PhysicsSettings.reduce((total, setting) => total + setting.Output.length, 0));
  assert.equal(physics.Meta.VertexCount, physics.PhysicsSettings.reduce((total, setting) => total + setting.Vertices.length, 0));
  assert.deepEqual(physics.PhysicsSettings.map(setting => setting.Output[0].Destination.Id), [
    'ParamHairFront',
    'ParamHairSide',
    'ParamHairBack',
  ]);
  for (const setting of physics.PhysicsSettings) {
    for (const input of setting.Input) assert.ok(parameterIds.has(input.Source.Id));
    for (const output of setting.Output) assert.ok(parameterIds.has(output.Destination.Id));
    assert.ok(setting.Output.every(output => output.VertexIndex < setting.Vertices.length));
  }

  const hotZoneMotion = id => profile.hotZones
    .find(zone => zone.id === id)
    ?.action.actions?.find(action => action.type === 'playMotion')?.motionGroup;
  assert.equal(hotZoneMotion('hair_clip'), 'TouchHairClip');
  assert.equal(hotZoneMotion('head'), 'TouchHead');
  assert.equal(hotZoneMotion('hand'), 'Wave');
  const controllerSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'avatar', 'live2d', 'Live2DCanvasController.ts'), 'utf8');
  assert.ok(controllerSource.includes('applyHotZoneVisualAction'));
  assert.ok(controllerSource.includes("action.type === 'composite'"));

  const qa = readJson(path.join(ROOT, 'docs', 'quality', 'live2d-cubism-runtime-qa.json'));
  assert.equal(qa.desktop.motionPhysics.passed, true);
  assert.equal(qa.desktop.motionPhysics.groupsChecked, 12);
  assert.equal(qa.desktop.motionPhysics.physicsLoadWarnings, 0);

  console.log(`ATHENA_LIVE2D_MOTION_PHYSICS_OK groups=${requiredGroups.length} curves=${curveCount} physics=${physics.PhysicsSettings.length} parameters=${parameterIds.size}`);
}

main();
