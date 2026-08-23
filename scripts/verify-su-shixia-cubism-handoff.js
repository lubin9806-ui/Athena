const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2', 'cubism-handoff');

function main() {
  const spec = readJson(path.join(HANDOFF_ROOT, 'rig-spec.json'));
  const physics = readJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.physics3.template.json'));
  const cdi = readJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.cdi3.template.json'));
  const runbook = fs.readFileSync(path.join(HANDOFF_ROOT, 'CUBISM_EXPORT_RUNBOOK.md'), 'utf8');
  const motionFiles = fs.readdirSync(path.join(HANDOFF_ROOT, 'motions')).filter(file => file.endsWith('.motion3.json'));

  assert.equal(spec.status, 'cubism_editor_handoff_ready');
  assert.equal(spec.parameters.length, 20);
  assert.ok(spec.parameters.some(item => item.id === 'ParamMouthOpenY'));
  assert.ok(spec.parameters.some(item => item.id === 'ParamHandCheek'));
  assert.equal(spec.meshGroups.length, 10);
  assert.ok(spec.meshGroups.some(item => item.id === 'Mouth' && item.parts.length === 6));
  assert.ok(spec.notAutomated.includes('no supported headless moc3 export command'));
  assert.equal(physics.Version, 3);
  assert.equal(physics.PhysicsSettings.length, 4);
  assert.equal(cdi.Version, 3);
  assert.ok(cdi.ParameterGroups.length >= 6);
  assert.ok(runbook.includes('Do not mark `.moc3` ready'));
  assert.ok(motionFiles.length >= 12);
  for (const file of motionFiles) {
    const motion = readJson(path.join(HANDOFF_ROOT, 'motions', file));
    assert.equal(motion.Version, 3);
    assert.ok(motion.Meta.Duration > 0);
    assert.ok(motion.Meta.CurveCount > 0);
    assert.ok(motion.Curves.every(curve => curve.Target === 'Parameter'));
  }

  console.log(`SU_SHIXIA_CUBISM_HANDOFF_OK parameters=${spec.parameters.length} motions=${motionFiles.length} physics=${physics.PhysicsSettings.length} automatedExport=false`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
