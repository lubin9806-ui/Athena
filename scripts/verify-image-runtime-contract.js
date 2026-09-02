const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'resources', 'image-runtime');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const builderPath = path.join(root, 'electron-builder.yml');
const requireRuntime = process.argv.includes('--require-runtime');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.engine, 'stable-diffusion.cpp');
assert.equal(manifest.executable, 'sd-cli.exe');
assert.equal(manifest.packageDestination, 'image-runtime');
assert.equal(manifest.requiresComfyUI, false);
assert.equal(manifest.modelDelivery, 'user-select');
assert.deepEqual(manifest.acceptedModelExtensions, ['.safetensors', '.gguf', '.ckpt', '.pth', '.pt']);
assert.deepEqual(manifest.variants.map(item => item.id), ['cuda12', 'vulkan', 'cpu']);
assert.deepEqual(manifest.variants.map(item => item.backend), ['cuda', 'vulkan', 'cpu']);
for (const variant of manifest.variants) {
  assert.equal(new URL(variant.downloadUrl).hostname, 'github.com');
  assert.match(variant.downloadUrl, /leejet\/stable-diffusion\.cpp\/releases\/download\//);
  assert.match(variant.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(variant.downloadBytes) && variant.downloadBytes > 0, true);
}

const builder = fs.readFileSync(builderPath, 'utf8');
assert.match(builder, /!resources\/image-runtime\/\*\*\/\*/);
assert.match(builder, /from: resources\/image-runtime\s+to: image-runtime/);

const executablePath = path.join(runtimeRoot, manifest.executable);
const executableReady = isRegularNonSymlink(executablePath);
if (requireRuntime) {
  assert.equal(executableReady, true, `Release local-image runtime is missing: ${executablePath}`);
}

console.log(`ATHENA_IMAGE_RUNTIME_CONTRACT_OK engine=${manifest.engine} package=external binary=${executableReady ? 'ready' : 'absent'} comfyui=not-required`);

function isRegularNonSymlink(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
