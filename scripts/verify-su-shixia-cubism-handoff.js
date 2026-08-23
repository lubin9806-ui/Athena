const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2', 'cubism-handoff');

function main() {
  const manifest = readJson(path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2', 'manifest.json'));
  const spec = readJson(path.join(HANDOFF_ROOT, 'rig-spec.json'));
  const physics = readJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.physics3.template.json'));
  const cdi = readJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.cdi3.template.json'));
  const exportGate = readJson(path.join(HANDOFF_ROOT, 'export-gate.json'));
  const auditReport = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-export-audit.json'));
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const profile = readJson(path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2', 'profile.avatar.json'));
  const runbook = fs.readFileSync(path.join(HANDOFF_ROOT, 'CUBISM_EXPORT_RUNBOOK.md'), 'utf8');
  const checklist = fs.readFileSync(path.join(HANDOFF_ROOT, 'CUBISM_EDITOR_READINESS_CHECKLIST.md'), 'utf8');
  const motionFiles = fs.readdirSync(path.join(HANDOFF_ROOT, 'motions')).filter(file => file.endsWith('.motion3.json'));
  const motionNames = new Set(motionFiles.map(file => path.basename(file, '.motion3.json')));

  assert.equal(manifest.sourceArt.cubismEditorReadinessChecklist, 'cubism-handoff/CUBISM_EDITOR_READINESS_CHECKLIST.md');
  assert.equal(manifest.sourceArt.cubismExportGate, 'cubism-handoff/export-gate.json');
  assert.equal(manifest.sourceArt.cubismExportAuditReport, '../../../docs/quality/su-shixia-cubism-export-audit.json');
  assert.equal(manifest.production.cubismEditorReadinessChecklistReady, true);
  assert.equal(manifest.production.cubismExportGateReady, true);
  assert.equal(manifest.production.cubismExportAuditReady, true);
  assert.equal(manifest.production.cubismAppearanceVisibilityParamReady, true);
  assert.equal(manifest.production.cubismExportReady, false);
  assert.ok(packageJson.scripts['test:live2d:su-shixia-cubism-audit'].includes('audit-su-shixia-cubism-export.js'));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-cubism-required'].includes('--require-go'));
  assert.equal(spec.status, 'cubism_editor_handoff_ready');
  assert.equal(spec.parameters.length, 21);
  assert.ok(spec.parameters.some(item => item.id === 'ParamMouthOpenY'));
  assert.ok(spec.parameters.some(item => item.id === 'ParamHandCheek'));
  assert.ok(spec.parameters.some(item => item.id === 'ParamAccessoryHairClip' && item.defaultValue === 1));
  assert.equal(spec.meshGroups.length, 10);
  assert.ok(spec.meshGroups.some(item => item.id === 'Mouth' && item.parts.length === 6));
  assert.ok(spec.deformers.some(item => item.id === 'Accessory' && item.parameters.includes('ParamAccessoryHairClip')));
  assert.equal(spec.appearanceControls.status, 'preview_mapping_ready_true_wardrobe_not_ready');
  assert.ok(spec.appearanceControls.cubismReadyControls.some(item => item.id === 'ParamAccessoryHairClip'));
  assert.ok(spec.appearanceControls.runtimeOnlyPreviewChannels.includes('hair tint'));
  assert.ok(spec.appearanceControls.wardrobeNoGo.some(item => item.includes('No alternate garment source layers')));
  assert.equal(spec.editorReadinessChecklist.length, 10);
  assert.ok(spec.editorReadinessChecklist.every(item => item.status === 'manual_required'));
  assert.ok(spec.notAutomated.includes('no supported headless moc3 export command'));
  assert.equal(physics.Version, 3);
  assert.equal(physics.PhysicsSettings.length, 4);
  assert.equal(cdi.Version, 3);
  assert.ok(cdi.ParameterGroups.length >= 7);
  assert.ok(cdi.ParameterGroups.some(group => group.Id === 'ParamGroupAppearance' && group.Ids.includes('ParamAccessoryHairClip')));
  assert.equal(exportGate.status, 'manual_export_required');
  assert.equal(exportGate.editor.headlessExportAvailable, false);
  assert.ok(exportGate.requiredRuntimeFiles.some(item => item.kind === 'moc3' && item.magic === 'MOC3'));
  assert.ok(exportGate.requiredRuntimeProof.some(item => item.includes('cubism-web')));
  assert.ok(exportGate.noGoUntil.some(item => item.includes('moc3 header')));
  assert.equal(auditReport.status, 'no_go');
  assert.equal(auditReport.goNoGoBoundary.liteRuntimePreview, 'go');
  assert.equal(auditReport.goNoGoBoundary.cubismEditorHandoff, 'go');
  assert.equal(auditReport.goNoGoBoundary.genuineCubismExport, 'no_go');
  assert.ok(auditReport.blockingItems.includes('runtime-file:moc3'));
  assert.ok(runbook.includes('Do not mark `.moc3` ready'));
  assert.ok(runbook.includes('Wardrobe Boundary'));
  assert.ok(checklist.includes('NO-GO for public Cubism default'));
  assert.ok(checklist.includes('ParamAccessoryHairClip'));
  assert.ok(motionFiles.length >= 30);
  const touchMotionGroups = new Set(profile.hotZones.map(zone => findMotionGroup(zone.action)).filter(Boolean));
  for (const motionGroup of touchMotionGroups) {
    assert.ok(motionNames.has(motionGroup), `missing Cubism motion template for ${motionGroup}`);
  }
  for (const file of motionFiles) {
    const motion = readJson(path.join(HANDOFF_ROOT, 'motions', file));
    assert.equal(motion.Version, 3);
    assert.ok(motion.Meta.Duration > 0);
    assert.ok(motion.Meta.CurveCount > 0);
    assert.ok(motion.Curves.every(curve => curve.Target === 'Parameter'));
  }

  console.log(`SU_SHIXIA_CUBISM_HANDOFF_OK parameters=${spec.parameters.length} motions=${motionFiles.length} physics=${physics.PhysicsSettings.length} exportGate=manual automatedExport=false`);
}

function findMotionGroup(action) {
  if (action.type === 'playMotion') return action.motionGroup;
  for (const child of action.actions ?? []) {
    const motion = findMotionGroup(child);
    if (motion) return motion;
  }
  return null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
