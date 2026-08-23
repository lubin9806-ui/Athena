const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const PACKET_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-motion-authoring-packet.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const packet = readJson(PACKET_PATH);
  const packageJson = readJson(path.join(ROOT, 'package.json'));

  assert.equal(manifest.sourceArt.motionAuthoringPacket, '../../../docs/quality/su-shixia-motion-authoring-packet.json');
  assert.equal(manifest.production.motionAuthoringPacketReady, true);
  assert.equal(packet.version, 1);
  assert.equal(packet.packageId, 'su-shixia-live2d-v2');
  assert.equal(packet.status, 'motion_authoring_packet_ready');
  assert.equal(packet.authoringRows.length, manifest.production.cubismMotionTemplateCount);
  assert.equal(packet.goNoGo.motionAuthoringPacket, 'go');
  assert.equal(packet.goNoGo.cubismMotionTemplates, 'go');
  assert.equal(packet.goNoGo.touchReactionStoryboard, 'go');
  assert.equal(packet.goNoGo.genuineCubismMotionPlayback, 'no_go');
  assert.equal(packet.goNoGo.trueTurn, 'no_go');

  assert.ok(packet.source.policy.includes('Do not copy third-party character assets'));
  assert.ok(packet.gestureTiers.length >= 7);
  assert.ok(packet.gestureTiers.every(tier => tier.present === true));
  assert.ok(packet.authoringRows.every(row => row.referenceFamilies.length > 0));
  assert.ok(packet.authoringRows.every(row => row.duration > 0 && row.duration <= 4));
  assert.ok(packet.authoringRows.every(row => row.curveCount >= 2));
  assert.ok(packet.authoringRows.every(row => row.cubismPolishNeeded.length >= 3));
  assert.ok(packet.qaRepresentatives.every(item => item.present === true));

  const speak = row(packet, 'Speak');
  assert.ok(speak.parameterIds.includes('ParamMouthOpenY'));
  assert.ok(speak.parameterIds.includes('ParamMouthForm'));
  assert.equal(packet.voiceSyncReview.status, 'handoff_ready');
  assert.ok(packet.voiceSyncReview.requiredRuntimeBlend.some(item => item.includes('TTS amplitude')));

  const touchFace = row(packet, 'TouchFace');
  assert.ok(touchFace.zones.some(zone => zone.id === 'face_cheek'));
  assert.ok(touchFace.authoringIntent.includes('挡脸'));
  assert.ok(row(packet, 'TouchChest').zones.some(zone => zone.privateModeAllowed === true));
  assert.ok(row(packet, 'TouchThigh').zones.some(zone => zone.privateModeAllowed === true));
  assert.ok(packet.touchReview.privateOrSensitiveMotions.includes('TouchChest'));
  assert.ok(packet.touchReview.privateOrSensitiveMotions.includes('TouchThigh'));
  assert.ok(packet.touchReview.runtimeBoundary.includes('Persona may write'));

  assert.equal(packet.turnReview.status, 'preview_only');
  assert.ok(packet.turnReview.noGoForTrueTurn.includes('No profile source package.'));
  assert.ok(row(packet, 'TurnPreview').stiffnessRisk === 'high');
  assert.ok(packet.stiffnessReview.highRisk.includes('TurnPreview'));

  assert.ok(packet.approvalGates.every(item => item.status === 'pass'));
  assert.ok(packet.approvalGates.some(item => item.id === 'third-party-assets-not-copied'));
  assert.ok(packet.approvalGates.some(item => item.id === 'true-turn-still-blocked'));
  assert.ok(profile.interactionPolicy.forbiddenPublicAssetTypes.includes('adult_motion'));
  assert.ok(packet.nextRequiredEvidence.some(item => item.includes('Cubism Editor playback capture')));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-motion-authoring'].includes('verify-su-shixia-motion-authoring-packet.js'));

  console.log(`SU_SHIXIA_MOTION_AUTHORING_PACKET_OK motions=${packet.authoringRows.length} highRisk=${packet.stiffnessReview.highRisk.length}`);
}

function row(packet, motionGroup) {
  const item = packet.authoringRows.find(value => value.motionGroup === motionGroup);
  assert.ok(item, `missing authoring row for ${motionGroup}`);
  return item;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
