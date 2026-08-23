const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  emotionFromLabel,
  findAthenaReplyPrompt,
  readAthenaLive2DPreferences,
} = require('../dist/renderer/avatar/live2d/AthenaLive2DCompanion');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  const manifest = JSON.parse(read('assets/avatar/athena-live2d-default/manifest.json'));
  const suShixiaManifest = JSON.parse(read('assets/avatar/su-shixia-live2d-v2/manifest.json'));
  const suShixiaProfile = JSON.parse(read('assets/avatar/su-shixia-live2d-v2/profile.avatar.json'));
  const suShixiaLiteModel = JSON.parse(read('assets/avatar/su-shixia-live2d-v2/model/su-shixia-live2d-v2-lite.model3.json'));
  const haruManifest = JSON.parse(read('assets/avatar/live2d-official-haru/manifest.json'));
  const haruProfile = JSON.parse(read('assets/avatar/live2d-official-haru/profile.avatar.json'));
  const haruModel = JSON.parse(read('assets/avatar/live2d-official-haru/Haru.model3.json'));
  const qa = JSON.parse(read('docs/quality/live2d-cubism-runtime-qa.json'));
  assert.equal(manifest.status, 'retired_visual_direction');
  assert.equal(manifest.qualityDisposition, 'retired_not_default');
  assert.equal(manifest.supersededBy, '../../../docs/LIVE2D_RESTART_V2.md');
  assert.equal(manifest.runtime.athenaAppIntegrated, true);
  assert.equal(manifest.runtime.hotZoneAthenaReply, true);
  assert.equal(suShixiaManifest.status, 'lite_runtime_preview_ready');
  assert.equal(suShixiaManifest.production.athenaDefaultVariant, true);
  assert.equal(suShixiaManifest.production.cubismExportReady, false);
  assert.equal(suShixiaProfile.id, 'su-shixia-live2d-v2');
  assert.equal(suShixiaProfile.model.model3JsonPath, 'model/su-shixia-live2d-v2-lite.model3.json');
  assert.equal(suShixiaLiteModel.AthenaLive2DLite.layers.length, 68);
  assert.ok(suShixiaProfile.hotZones.some(zone => zone.id === 'face_cheek'));
  assert.ok(suShixiaProfile.hotZones.some(zone => zone.id === 'chest'));
  assert.equal(haruManifest.runtime.sounds, 0);
  assert.equal(haruProfile.hotZones.length >= 8, true);
  assert.ok(haruProfile.motions.some(motion => motion.state === 'thinking' && motion.motionGroup === 'Think' && motion.loop));
  assert.ok(haruProfile.motions.some(motion => motion.state === 'speaking' && motion.motionGroup === 'Speak' && motion.loop));
  for (const group of ['Listen', 'Think', 'Speak', 'Greet', 'Nod', 'ShakeHead', 'Wave', 'TouchHead', 'TouchHair', 'TouchHand', 'TouchOutfit', 'Sleepy']) {
    assert.ok(Array.isArray(haruModel.FileReferences.Motions[group]), `Haru model missing motion group ${group}`);
  }
  const referencedHaruMotions = new Set(Object.values(haruModel.FileReferences.Motions).flat().map(motion => motion.File));
  assert.equal(referencedHaruMotions.size, 27);
  assert.equal(JSON.stringify(haruModel.FileReferences.Motions).includes('"Sound"'), false);
  assert.equal(qa.athenaAppIntegration.passed, true);
  assert.equal(qa.athenaAppIntegration.electronSmoke, 'ATHENA_SMOKE_DOM_OK');

  assert.equal(emotionFromLabel('开心'), 'happy');
  assert.equal(emotionFromLabel('需要认真思考'), 'thoughtful');
  assert.equal(emotionFromLabel('温柔'), 'soft');
  assert.equal(emotionFromLabel('unknown'), 'peaceful');

  assert.deepEqual(readAthenaLive2DPreferences(null), {
    version: 1,
    enabled: true,
    layout: 'chat_right',
    scale: 1,
    opacity: 0.98,
    modelVariant: 'su_shixia_v2',
  });
  assert.deepEqual(readAthenaLive2DPreferences(JSON.stringify({
    version: 1,
    enabled: false,
    layout: 'desktop_pet',
    scale: 9,
    opacity: -2,
    modelVariant: 'athena_default',
  })), {
    version: 1,
    enabled: false,
    layout: 'desktop_pet',
    scale: 1.45,
    opacity: 0.3,
    modelVariant: 'athena_default',
  });
  assert.deepEqual(readAthenaLive2DPreferences(JSON.stringify({
    version: 1,
    enabled: true,
    layout: 'chat_right',
    scale: 1,
    opacity: 1,
    modelVariant: 'su_shixia_v2',
  })).modelVariant, 'su_shixia_v2');
  assert.deepEqual(readAthenaLive2DPreferences(JSON.stringify({
    version: 1,
    enabled: true,
    layout: 'chat_background',
    scale: 1,
    opacity: 1,
    modelVariant: 'unknown',
  })).modelVariant, 'su_shixia_v2');

  assert.equal(findAthenaReplyPrompt({
    type: 'composite',
    actions: [
      { type: 'playMotion', motionGroup: 'Wave' },
      { type: 'athenaReply', promptTemplate: ' respond naturally ' },
    ],
  }), 'respond naturally');

  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.ts');
  const css = read('src/renderer/style.css');
  const live2dCompanion = read('src/renderer/avatar/live2d/AthenaLive2DCompanion.ts');
  for (const id of [
    'live2d-companion',
    'live2d-companion-canvas',
    'setting-live2d-enabled',
    'setting-live2d-layout',
    'setting-live2d-scale',
    'setting-live2d-opacity',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `renderer HTML missing ${id}`);
  }
  for (const contract of [
    'modelVariant',
    'su_shixia_v2',
    'su-shixia-live2d-v2',
    'official_haru',
    'live2d-official-haru',
  ]) {
    assert.ok(live2dCompanion.includes(contract), `Live2D companion integration missing ${contract}`);
  }
  for (const contract of [
    'chat.thinking.start',
    'chat.streaming.start',
    'voice.listening.start',
    'attachAudio(audio)',
    'sendAvatarInteraction',
    'setEmotionLabel',
  ]) {
    assert.ok(app.includes(contract), `renderer integration missing ${contract}`);
  }
  for (const layout of ['chat_right', 'chat_background', 'draggable_overlay', 'desktop_pet']) {
    assert.ok(css.includes(`[data-layout="${layout}"]`), `renderer CSS missing ${layout}`);
  }

  console.log('ATHENA_LIVE2D_APP_INTEGRATION_OK layouts=4 chat=bound emotion=bound voice=analyser settings=local-v1');
}

main();
