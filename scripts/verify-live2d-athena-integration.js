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
  const qa = JSON.parse(read('docs/quality/live2d-cubism-runtime-qa.json'));
  assert.equal(manifest.status, 'desktop_pet_window_validated');
  assert.equal(manifest.runtime.athenaAppIntegrated, true);
  assert.equal(manifest.runtime.hotZoneAthenaReply, true);
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
  });
  assert.deepEqual(readAthenaLive2DPreferences(JSON.stringify({
    version: 1,
    enabled: false,
    layout: 'desktop_pet',
    scale: 9,
    opacity: -2,
  })), {
    version: 1,
    enabled: false,
    layout: 'desktop_pet',
    scale: 1.45,
    opacity: 0.3,
  });

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
