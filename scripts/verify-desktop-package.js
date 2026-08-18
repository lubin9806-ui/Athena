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
  assert(!entries.includes('config/settings.json'), 'Packaged application contains developer or user settings.');
  assert.equal(entries.filter(value => value.endsWith('.map')).length, 0, 'Packaged application contains source maps.');
  assert.equal(entries.filter(value => value.endsWith('.d.ts')).length, 0, 'Packaged application contains declarations.');

  const buildInfo = readJson(path.join(resources, 'build-info.json'));
  const updateConfig = readJson(path.join(resources, 'update-config.json'));
  const updaterMetadata = fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8');
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
  assert.deepStrictEqual(relativeExecutables.sort(), approvedExecutables.sort(), 'Desktop package contains an unapproved executable.');
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

  console.log(`ATHENA_DESKTOP_PACKAGE_OK version=${pkg.version} channel=${buildInfo.channel} entries=${entries.length} settings=excluded maps=0`);
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
