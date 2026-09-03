const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const {
  ROOT,
  authenticode,
  buildInputHash,
  normalizeUpdateBaseUrl,
  packageMetadata,
  readJson,
  releaseChannel,
  sha256,
} = require('./release-common');

const PYTHON_PUBLISHER = 'CN=Python Software Foundation, O=Python Software Foundation, L=Beaverton, S=Oregon, C=US';

function executableVersionInfo(filePath) {
  if (process.platform !== 'win32') {
    return { ProductName: '', FileDescription: '', OriginalFilename: '' };
  }
  const literal = filePath.replace(/'/g, "''");
  const command = `& { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $file = Get-Item -LiteralPath '${literal}'; [pscustomobject]@{ ProductName = [string]$file.VersionInfo.ProductName; FileDescription = [string]$file.VersionInfo.FileDescription; OriginalFilename = [string]$file.VersionInfo.OriginalFilename } | ConvertTo-Json -Compress }`;
  const result = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
  assert.equal(result.status, 0, `Unable to inspect executable version info for ${filePath}.`);
  return JSON.parse(result.stdout.trim());
}

function artifactRecord(filePath) {
  assert(fs.existsSync(filePath), `Desktop package artifact is missing: ${filePath}`);
  const signature = authenticode(filePath);
  return {
    file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
    authenticode: signature.status,
    signedAndTimestamped: signature.valid === true && Boolean(signature.timestampSubject),
  };
}

function findExecutables(directory) {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...findExecutables(absolute));
    else if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) files.push(absolute);
  }
  return files;
}

function verifyPackagedImageRuntime(resources) {
  const runtimeRoot = path.join(resources, 'image-runtime');
  const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
  assert(fs.existsSync(manifestPath), 'Desktop package is missing the local-image runtime manifest.');
  const manifest = readJson(manifestPath);
  assert.equal(manifest.schemaVersion, 1, 'Packaged local-image runtime manifest schema is invalid.');
  assert.equal(manifest.engine, 'stable-diffusion.cpp', 'Packaged local-image engine is invalid.');
  assert.equal(manifest.executable, 'sd-cli.exe', 'Packaged local-image executable contract is invalid.');
  assert.equal(manifest.packageDestination, 'image-runtime', 'Packaged local-image destination is invalid.');
  assert.equal(manifest.requiresComfyUI, false, 'Packaged local-image generation must not require ComfyUI.');
  assert.equal(manifest.runtimeDelivery, 'release-gated', 'Packaged local-image delivery policy is invalid.');
  assert.equal(manifest.modelDelivery, 'user-select', 'Packaged local-image model policy is invalid.');
  assert.deepStrictEqual(
    manifest.variants.map(item => item.id),
    ['cuda12', 'vulkan', 'cpu'],
    'Packaged local-image runtime choices are incomplete.',
  );
  for (const variant of manifest.variants) {
    assert.equal(new URL(variant.downloadUrl).protocol, 'https:', 'Local-image runtime download must use HTTPS.');
    assert.equal(new URL(variant.downloadUrl).hostname, 'github.com', 'Local-image runtime download host is not approved.');
    assert.match(variant.sha256, /^[a-f0-9]{64}$/, 'Local-image runtime archive SHA-256 is invalid.');
    assert(Number.isSafeInteger(variant.downloadBytes) && variant.downloadBytes > 0, 'Local-image runtime archive size is invalid.');
  }

  const runtimePath = path.join(runtimeRoot, manifest.executable);
  if (!fs.existsSync(runtimePath)) return { delivery: 'on-demand', executable: '' };
  assert(fs.lstatSync(runtimePath).isFile() && !fs.lstatSync(runtimePath).isSymbolicLink(), 'Bundled local-image runtime must be a regular file.');
  assert.match(
    manifest.bundledExecutableSha256 || '',
    /^[a-f0-9]{64}$/,
    'Bundled local-image runtime is missing its reviewed SHA-256.',
  );
  assert.equal(sha256(runtimePath), manifest.bundledExecutableSha256.toUpperCase(), 'Bundled local-image runtime SHA-256 is invalid.');
  return { delivery: 'bundled', executable: runtimePath };
}

function main() {
  const pkg = packageMetadata();
  const resources = path.join(ROOT, 'release', 'win-unpacked', 'resources');
  const installer = path.join(ROOT, 'release', `Athena Setup ${pkg.version}.exe`);
  const executable = path.join(ROOT, 'release', 'win-unpacked', 'Athena.exe');
  const blockmap = `${installer}.blockmap`;
  const asarPath = path.join(resources, 'app.asar');
  for (const required of [installer, executable, blockmap, asarPath]) {
    assert(fs.existsSync(required), `Desktop package artifact is missing: ${required}`);
  }

  const entries = asar.listPackage(asarPath).map(value => value.replace(/^\\/, '').replace(/\\/g, '/'));
  const packagedMetadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  assert.equal(packagedMetadata.version, pkg.version, 'Packaged application version does not match package.json.');
  assert(entries.includes('dist/core/update/DesktopUpdater.js'), 'Packaged application is missing DesktopUpdater.');
  assert(entries.includes('dist/core/update/UpdatePolicy.js'), 'Packaged application is missing UpdatePolicy.');
  assert(entries.includes('dist/core/ai/CredentialStore.js'), 'Packaged application is missing the encrypted credential store.');
  assert(entries.includes('dist/shared/releaseFeatures.js'), 'Packaged application is missing its release feature policy.');
  assert(entries.includes('dist/core/skills/SkillLibrary.js'), 'Packaged application is missing the governed Skill library.');
  assert(entries.includes('dist/core/skills/SkillAgentToolBridge.js'), 'Packaged application is missing the Skill tool bridge.');
  assert(entries.includes('dist/core/tools/ComputerToolCatalog.js'), 'Packaged application is missing the modular computer-tool catalog.');
  for (const imageModule of [
    'dist/core/artifacts/ComfyUIImageGenerationProvider.js',
    'dist/core/artifacts/ImageGenerationRouter.js',
    'dist/core/artifacts/LocalImageGenerationProvider.js',
    'dist/core/artifacts/LocalImageRuntimeManager.js',
    'dist/core/artifacts/RemoteImageGenerationProviders.js',
  ]) {
    assert(entries.includes(imageModule), `Packaged application is missing image-generation module: ${imageModule}`);
  }
  const releaseFeatures = asar.extractFile(asarPath, path.join('dist', 'shared', 'releaseFeatures.js')).toString('utf8');
  const credentialStore = asar.extractFile(asarPath, path.join('dist', 'core', 'ai', 'CredentialStore.js')).toString('utf8');
  assert.match(releaseFeatures, /live2d:\s*false/, 'Packaged release feature policy must keep Live2D disabled.');
  assert.match(credentialStore, /safeStorage\.encryptString/, 'Packaged credential store does not encrypt saved API credentials.');
  assert.match(credentialStore, /safeStorage\.decryptString/, 'Packaged credential store cannot decrypt saved API credentials.');
  assert(!entries.includes('config/settings.json'), 'Packaged application contains developer or user settings.');
  assert(!entries.includes('config/settings.local.json'), 'Packaged application contains a local developer settings overlay.');
  assert(!entries.includes('config/model.local.json'), 'Packaged application contains a local developer model overlay.');
  assert(!entries.includes('config/model.json'), 'Packaged application contains a developer model/API configuration.');
  assert(!entries.includes('config/skills.json'), 'Packaged application contains the obsolete declarative skill shell.');
  assert(!entries.some(value => value.startsWith('dist/skills/')), 'Packaged application contains the obsolete SkillManager shell.');
  assert(!entries.some(value => value.startsWith('config/personas/')), 'Packaged application contains user-imported persona cards.');
  assert(!entries.some(value => value.startsWith('config/private/')), 'Packaged application contains private configuration.');
  assert(!entries.some(value => value.startsWith('personality/private/')), 'Packaged application contains a private persona card.');
  assert(!entries.some(value => value.startsWith('assets/avatar/')), 'Packaged application contains disabled avatar assets.');
  assert(!entries.some(value => value.startsWith('assets/vendor/live2d/')), 'Packaged application contains the disabled Live2D vendor runtime.');
  assert(!entries.some(value => value.startsWith('dist/app/avatar/')), 'Packaged application contains the disabled desktop-pet runtime.');
  assert(!entries.includes('dist/app/live2d-preload.js'), 'Packaged application contains the disabled Live2D preload.');
  assert(!entries.some(value => value.startsWith('dist/renderer/avatar/')), 'Packaged application contains the disabled renderer avatar runtime.');
  assert(!entries.some(value => /(^|\/)live2d-(?:pet|preview)(?:\.|\/)/i.test(value)), 'Packaged application contains a Live2D preview or pet entry point.');
  assert(!entries.some(value => value.startsWith('node_modules/untitled-pixi-live2d-engine/')), 'Packaged application contains the disabled Live2D engine dependency.');
  assert.equal(entries.filter(value => value.endsWith('.map')).length, 0, 'Packaged application contains source maps.');
  assert.equal(entries.filter(value => value.endsWith('.d.ts')).length, 0, 'Packaged application contains declarations.');

  const buildInfo = readJson(path.join(resources, 'build-info.json'));
  const updateConfig = readJson(path.join(resources, 'update-config.json'));
  const updaterMetadata = fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8');
  const imageRuntime = verifyPackagedImageRuntime(resources);
  assert.equal(buildInfo.version, pkg.version);
  assert.equal(buildInfo.channel, releaseChannel(pkg.version));
  assert.equal(buildInfo.buildInputSha256, buildInputHash(), 'Build inputs changed after the desktop package was created.');
  assert.equal(updateConfig.schemaVersion, 1);
  assert.equal(updateConfig.channel, buildInfo.channel);
  if (updateConfig.enabled) {
    assert.equal(normalizeUpdateBaseUrl(updateConfig.baseUrl), updateConfig.baseUrl, 'Enabled updater URL is not approved.');
    assert(!updaterMetadata.includes('updates.invalid'), 'Enabled updater contains the disabled placeholder URL.');
  } else {
    assert.equal(updateConfig.baseUrl, '');
    assert(updaterMetadata.includes('https://updates.invalid/athena-disabled'));
  }

  const packagedExecutables = findExecutables(path.join(ROOT, 'release', 'win-unpacked'));
  const relativeExecutables = packagedExecutables.map(file => path.relative(path.join(ROOT, 'release'), file).replace(/\\/g, '/'));
  const approvedExecutables = [
    'win-unpacked/Athena.exe',
    'win-unpacked/resources/elevate.exe',
    'win-unpacked/resources/voice/python/python.exe',
  ];
  if (imageRuntime.executable) {
    approvedExecutables.push(path.relative(path.join(ROOT, 'release'), imageRuntime.executable).replace(/\\/g, '/'));
  }
  assert.deepStrictEqual(relativeExecutables.sort(), approvedExecutables.sort(), 'Desktop package contains an unapproved executable.');
  const executableInfo = executableVersionInfo(executable);
  assert.equal(executableInfo.ProductName, 'Athena', 'Desktop executable ProductName must be Athena, not Electron.');
  assert.equal(executableInfo.FileDescription, 'Athena', 'Desktop executable FileDescription must be Athena, not Electron.');
  const pythonPath = path.join(resources, 'voice', 'python', 'python.exe');
  const pythonSignature = authenticode(pythonPath);
  assert.equal(pythonSignature.status, 'Valid', 'Managed Python runtime signature is invalid.');
  assert.equal(pythonSignature.subject, PYTHON_PUBLISHER, 'Managed Python runtime publisher is not approved.');
  assert(pythonSignature.timestampSubject, 'Managed Python runtime is missing a signature timestamp.');
  const voiceManifest = readJson(path.join(resources, 'voice', 'voice-runtime-manifest.json'));
  const pythonManifest = voiceManifest.files.find(item => item.path === 'python/python.exe');
  assert(pythonManifest, 'Managed Python runtime is missing from the voice manifest.');
  assert.equal(pythonManifest.sha256.toUpperCase(), sha256(pythonPath), 'Managed Python runtime does not match the voice manifest.');

  const ownedArtifacts = [artifactRecord(installer), artifactRecord(executable), artifactRecord(path.join(resources, 'elevate.exe'))];
  const blockers = [];
  if (!buildInfo.cleanCheckout) blockers.push('CLEAN_CHECKOUT_NOT_PROVEN');
  if (!updateConfig.enabled) blockers.push('PRODUCTION_UPDATE_FEED_DISABLED');
  if (ownedArtifacts.some(item => !item.signedAndTimestamped)) blockers.push('AUTHENTICODE_OR_TIMESTAMP_INVALID');

  console.log(`ATHENA_DESKTOP_PACKAGE_OK version=${pkg.version} channel=${buildInfo.channel} entries=${entries.length} settings=excluded modelConfig=excluded personas=public-default memory=empty live2d=disabled imageRuntime=${imageRuntime.delivery} comfyui=optional maps=0`);
  for (const artifact of ownedArtifacts) {
    console.log(`ATHENA_DESKTOP_ARTIFACT file=${artifact.file} bytes=${artifact.bytes} sha256=${artifact.sha256} authenticode=${artifact.authenticode}`);
  }
  if (blockers.length) console.log(`ATHENA_DESKTOP_PACKAGE_BLOCKED ${blockers.join(',')}`);
  else console.log('ATHENA_DESKTOP_PACKAGE_DISTRIBUTABLE');
}

try {
  main();
} catch (error) {
  console.error(`ATHENA_DESKTOP_PACKAGE_VERIFY_FAILED ${error.message}`);
  process.exit(1);
}
