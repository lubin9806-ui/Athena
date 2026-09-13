const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const electronPath = require('electron');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  const manifest = JSON.parse(read('assets/avatar/athena-live2d-default/manifest.json'));
  const qa = JSON.parse(read('docs/quality/live2d-cubism-runtime-qa.json'));
  assert.equal(manifest.status, 'retired_visual_direction');
  assert.equal(manifest.qualityDisposition, 'retired_not_default');
  assert.equal(manifest.runtime.desktopPetWindow.independentWindow, true);
  assert.equal(qa.desktopPetWindow.passed, true);
  const manager = read('src/app/avatar/DesktopPetWindow.ts');
  const preload = read('src/app/live2d-preload.ts');
  const renderer = read('src/renderer/live2d-pet.ts');
  const html = read('src/renderer/live2d-pet.html');
  const host = read('src/renderer/avatar/live2d/BrowserCubismLive2DHost.ts');
  const vite = read('vite.config.mts');
  const releaseFeatures = read('src/shared/releaseFeatures.ts');
  for (const contract of ['transparent: true', 'alwaysOnTop: true', 'skipTaskbar: true', 'setVisibleOnAllWorkspaces', 'cleanAvatarEvent']) {
    assert.ok(manager.includes(contract), `desktop pet manager missing ${contract}`);
  }
  for (const contract of ['avatar:desktop:hide', 'avatar:desktop:ready', 'avatar:desktop:interaction']) {
    assert.ok(preload.includes(contract), `desktop pet preload missing ${contract}`);
  }
  assert.ok(renderer.includes('lipSync.update'));
  assert.ok(renderer.includes('preferences.update'));
  assert.ok(renderer.includes('outfitId: event.outfitId'));
  assert.ok(manager.includes('cleaned.outfitId'));
  assert.ok(html.includes('live2d-pet-canvas'));
  assert.ok(html.includes("connect-src 'self' file: data: blob:"));
  assert.ok(!html.includes("'unsafe-eval'"), 'desktop pet CSP must not enable unsafe-eval');
  assert.ok(host.includes("import('pixi.js/unsafe-eval')"), 'Pixi CSP-safe polyfill must load before renderer initialization');
  assert.ok(host.includes('visibleMotionPose'), 'Cubism host must provide visible runtime motion fallback');
  for (const contract of ['ENABLE_VISIBLE_LAYERED_RUNTIME_RIG = false', 'createLayeredPerformanceRig', 'hairSideL', 'eyeL', 'mouth', 'armR', 'skirt', 'sleeveR']) {
    assert.ok(host.includes(contract), `Cubism host is missing visible layered mesh contract: ${contract}`);
  }
  assert.match(releaseFeatures, /live2d:\s*false/, 'Live2D must remain disabled for release');
  assert.match(vite, /disabledPaths\s*=\s*\[\s*['"]avatar['"]\s*\]/, 'Vite must prune the renderer avatar tree');
  assert.doesNotMatch(vite, /\blive2dPet\s*:/, 'Vite must not build the disabled desktop-pet entry point');
  assert.equal(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'avatar')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'live2d-pet.html')), false);

  const result = spawnSync(electronPath, [ROOT, '--smoke-test'], {
    cwd: ROOT,
    env: { ...process.env, ATHENA_SMOKE_LIVE2D_PET: '1' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) process.stderr.write(output);
  assert.equal(result.status, 0, 'release-disabled Electron smoke failed');
  assert.match(output, /ATHENA_SMOKE_DOM_OK/);
  assert.doesNotMatch(output, /ATHENA_LIVE2D_PET_READY/, 'disabled release unexpectedly started the desktop pet');
  assert.doesNotMatch(output, /ATHENA_LIVE2D_DESKTOP_PET_STATE/, 'disabled release unexpectedly emitted desktop-pet state');
  console.log('ATHENA_LIVE2D_DESKTOP_PET_DISABLED_OK source=archived release=disabled renderer=pruned smoke=main-window-only');
}

main();
