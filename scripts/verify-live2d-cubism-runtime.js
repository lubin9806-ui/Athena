const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, manifest.runtime.profile));
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const qa = readJson(path.join(ROOT, 'docs', 'quality', 'live2d-cubism-runtime-qa.json'));
  const runtimeModelPath = path.join(PACKAGE_ROOT, manifest.runtime.model3Json);
  const sourceModelPath = path.join(PACKAGE_ROOT, manifest.runtime.expectedCubismModel3Json);
  const runtimeModel = readJson(runtimeModelPath);
  const sourceModel = readJson(sourceModelPath);
  const runtimeMocPath = path.join(path.dirname(runtimeModelPath), runtimeModel.FileReferences.Moc);
  const sourceMocPath = path.join(path.dirname(sourceModelPath), sourceModel.FileReferences.Moc);
  const runtimeMoc = fs.readFileSync(runtimeMocPath);
  const sourceMoc = fs.readFileSync(sourceMocPath);
  const corePath = path.join(ROOT, 'assets', 'vendor', 'live2d', 'live2dcubismcore.min.js');

  assert.ok([
    'cubism_runtime_validated',
    'cubism_realtime_controls_validated',
    'cubism_motion_physics_validated',
    'cubism_native_expressions_validated',
    'athena_app_integration_validated',
    'desktop_pet_window_validated',
    'retired_visual_direction',
  ].includes(manifest.status));
  assert.equal(manifest.runtime.cubismRunnable, true);
  assert.equal(manifest.runtime.engine, 'cubism-web');
  assert.equal(profile.model.model3JsonPath, manifest.runtime.model3Json);
  assert.deepEqual(manifest.runtime.validatedPlacements, [
    'chat_right',
    'chat_background',
    'draggable_overlay',
    'desktop_pet',
  ]);
  assert.equal(packageJson.dependencies['untitled-pixi-live2d-engine'], '1.3.5');
  assert.equal(packageJson.dependencies['pixi.js'], '8.20.0');
  assert.equal(runtimeMoc.subarray(0, 4).toString('ascii'), 'MOC3');
  assert.equal(runtimeMoc[4], 5, 'runtime MOC must remain compatible with the pinned SDK 5 renderer');
  assert.equal(sourceMoc[4], 6, 'the Cubism 5.3 source export must remain preserved');
  assert.ok(runtimeMoc.length > 88000);
  assert.ok(sourceMoc.length > runtimeMoc.length);
  for (const id of ['ATH_EXPRESSION_BLINK_PATCH', 'ATH_EXPRESSION_SPEAK_PATCH', 'ATH_EXPRESSION_HAPPY_PATCH']) {
    assert.ok(runtimeMoc.includes(Buffer.from(id, 'ascii')), `runtime MOC is missing ${id}`);
  }
  for (const texture of runtimeModel.FileReferences.Textures) {
    const textureStats = await inspectTexture(path.join(path.dirname(runtimeModelPath), texture));
    assert.equal(textureStats.width, 4096);
    assert.equal(textureStats.height, 4096);
    assert.ok(textureStats.visiblePixels > 500000, `texture ${texture} must contain visible avatar pixels`);
    assert.ok(textureStats.transparentPixels > 500000, `texture ${texture} must preserve transparent background`);
  }
  assert.equal(manifest.production.alphaFringeRepaired, true);
  assert.equal(manifest.runtime.visibleMotionFallback, true);
  assert.equal(sha256(corePath), manifest.runtime.coreSha256);
  assert.equal(qa.result, 'pass');
  assert.equal(qa.desktop.consoleErrors, 0);
  assert.equal(qa.narrow.consoleErrors, 0);
  assert.equal(qa.desktop.drag.passed, true);
  assert.equal(qa.desktop.hotZone.passed, true);
  assert.equal(qa.narrow.horizontalOverflow, false);

  const hostSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'avatar', 'live2d', 'BrowserCubismLive2DHost.ts'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'avatar', 'live2d', 'Live2DCanvasController.ts'), 'utf8');
  for (const contract of ['Live2DModel.from', 'beforeModelUpdate', 'fallbackHost', 'ResizeObserver', 'hitTestCanvasPoint']) {
    assert.ok(hostSource.includes(contract), `Cubism host is missing runtime contract: ${contract}`);
  }
  for (const contract of ['draggable_overlay', 'desktop_pet', 'pointInsideHotZone', 'setPointerCapture']) {
    assert.ok(controllerSource.includes(contract), `Live2D controller is missing placement contract: ${contract}`);
  }

  console.log(`ATHENA_LIVE2D_CUBISM_RUNTIME_OK moc=${runtimeMoc.length} sourceMoc=${sourceMoc.length} placements=${manifest.runtime.validatedPlacements.length} status=${manifest.status} core=${manifest.runtime.coreSha256.slice(0, 12)}`);
}

async function inspectTexture(filePath) {
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let visiblePixels = 0;
  let transparentPixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) visiblePixels += 1;
    else transparentPixels += 1;
  }
  return { width: image.width, height: image.height, visiblePixels, transparentPixels };
}

main().catch(error => {
  console.error('ATHENA_LIVE2D_CUBISM_RUNTIME_FAILED', error);
  process.exitCode = 1;
});
