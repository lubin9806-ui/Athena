const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./release-common');

const EXPECTED = {
  storeId: '9NT09L9504R1',
  identityName: 'AthenaL.AthenaAIcompanion',
  publisher: 'CN=3D06B086-15FC-4F75-8056-021840D60F44',
  publisherDisplayName: 'Athena L',
  packageFamilyName: 'AthenaL.AthenaAIcompanion_gf9pv7kh6znee',
};

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  assert.equal(header.toString('hex', 0, 8), '89504e470d0a1a0a', `${filePath} is not PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function readArchiveEntry(artifact, entryName) {
  const escapedArtifact = artifact.replace(/'/g, "''");
  const escapedEntry = entryName.replace(/'/g, "''");
  const command = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$archive=[System.IO.Compression.ZipFile]::OpenRead('${escapedArtifact}')`,
    `try{$entry=$archive.Entries|Where-Object{$_.FullName -eq '${escapedEntry}'}|Select-Object -First 1;if(-not $entry){exit 7};$reader=[System.IO.StreamReader]::new($entry.Open());try{$reader.ReadToEnd()}finally{$reader.Dispose()}}finally{$archive.Dispose()}`,
  ].join(';');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Archive entry is missing: ${entryName}`);
  return result.stdout;
}

function listArchive(artifact) {
  const escapedArtifact = artifact.replace(/'/g, "''");
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem;$archive=[System.IO.Compression.ZipFile]::OpenRead('${escapedArtifact}');try{$archive.Entries|ForEach-Object{$_.FullName}}finally{$archive.Dispose()}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Unable to inspect Store package: ${artifact}`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function verifySource() {
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'microsoft-store.json'), 'utf8'));
  assert.equal(product.schemaVersion, 1);
  assert.equal(product.releaseStage, 'private-beta-draft');
  assert.equal(product.skuId, 'athena-microsoft-store-private-beta-v1');
  assert.equal(product.audience, 'private');
  assert.equal(product.updatesManagedBy, 'microsoft-store');
  assert.equal(product.externalPayments, false);
  for (const [key, value] of Object.entries(EXPECTED)) assert.equal(product[key], value, `Store identity drifted: ${key}`);

  const builder = fs.readFileSync(path.join(ROOT, 'electron-builder.store.yml'), 'utf8');
  for (const value of [EXPECTED.identityName, EXPECTED.publisher, EXPECTED.publisherDisplayName, 'target: appx', 'setBuildNumber: false', 'runFullTrust', 'internetClient', 'microphone']) {
    assert(builder.includes(value), `Store builder configuration is missing: ${value}`);
  }
  assert(!builder.includes('.build/update-config.json'), 'Store package must not contain Desktop Direct update configuration.');
  assert(!builder.includes('.build/app-update.yml'), 'Store package must not contain electron-updater metadata.');
  assert(builder.includes('!config/settings.json'), 'Store package must exclude developer settings and start from runtime defaults.');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build:store'], 'node scripts/build-microsoft-store.js --require-clean');
  const main = fs.readFileSync(path.join(ROOT, 'src', 'app', 'main.ts'), 'utf8');
  assert.match(main, /!isMicrosoftStoreBuild\) initializeDesktopUpdater/);
  assert.match(main, /Athena Microsoft Store/);
  const controller = fs.readFileSync(path.join(ROOT, 'src', 'core', 'controller', 'AthenaController.ts'), 'utf8');
  assert(!controller.includes('initializeDefaultProfile'), 'Store users must not receive developer-specific default memory.');

  const assets = [
    ['StoreLogo.png', 50, 50],
    ['Square44x44Logo.png', 44, 44],
    ['Square150x150Logo.png', 150, 150],
    ['Wide310x150Logo.png', 310, 150],
  ];
  for (const [name, width, height] of assets) {
    const file = path.join(ROOT, 'build', 'appx', name);
    assert(fs.existsSync(file), `Store asset is missing: ${name}`);
    assert.deepEqual(pngDimensions(file), { width, height }, `Store asset dimensions drifted: ${name}`);
  }

  const runtimeModule = require('../dist/core/store/MicrosoftStoreSku');
  const validRuntime = {
    schemaVersion: 1,
    skuId: 'athena-microsoft-store-private-beta-v1',
    storeId: EXPECTED.storeId,
    identityName: EXPECTED.identityName,
    packageFamilyName: EXPECTED.packageFamilyName,
    audience: 'private',
    updatesManagedBy: 'microsoft-store',
    storePackageVersion: '0.9.1.0',
    generatedAt: new Date(0).toISOString(),
  };
  runtimeModule.setMicrosoftStoreRuntimeOverrideForTests(validRuntime);
  assert.equal(runtimeModule.isMicrosoftStoreSku(), true);
  runtimeModule.setMicrosoftStoreRuntimeOverrideForTests(null);
  assert.equal(runtimeModule.isMicrosoftStoreSku(), false);
  runtimeModule.setMicrosoftStoreRuntimeOverrideForTests(undefined);
  console.log(`ATHENA_STORE_SOURCE_OK storeId=${EXPECTED.storeId} identity=${EXPECTED.identityName} audience=private`);
}

function verifyArtifact(value) {
  const artifact = path.resolve(value);
  assert(fs.existsSync(artifact), `Store package does not exist: ${artifact}`);
  assert(['.appx', '.msix'].includes(path.extname(artifact).toLowerCase()), 'Store package must be AppX or MSIX.');
  const entries = listArchive(artifact);
  for (const required of ['AppxManifest.xml', 'app/resources/app.asar', 'app/resources/store/store-runtime.json', 'app/resources/store/store-product.json']) {
    assert(entries.includes(required), `Store package is missing: ${required}`);
  }
  for (const forbidden of ['app/resources/app-update.yml', 'app/resources/update-config.json', 'app/resources/OllamaSetup.exe']) {
    assert(!entries.includes(forbidden), `Store package contains forbidden file: ${forbidden}`);
  }
  assert(!entries.some(entry => /(?:^|\/)(?:athena\.db-(?:wal|shm)|\.env|steam-runtime\.json)$/i.test(entry)), 'Store package contains runtime or foreign-SKU state.');

  const manifest = readArchiveEntry(artifact, 'AppxManifest.xml');
  for (const value of [EXPECTED.identityName, EXPECTED.publisher, 'Athena AI companion', 'runFullTrust', 'internetClient', 'microphone']) {
    assert(manifest.includes(value), `AppX manifest identity or capability is missing: ${value}`);
  }
  const runtime = JSON.parse(readArchiveEntry(artifact, 'app/resources/store/store-runtime.json'));
  assert.equal(runtime.storeId, EXPECTED.storeId);
  assert.equal(runtime.audience, 'private');
  assert.equal(runtime.updatesManagedBy, 'microsoft-store');
  assert.match(runtime.storePackageVersion, /^0\.9\.(?:[1-9]\d{0,4})\.0$/);
  const manifestVersion = manifest.match(/<Identity\b[^>]*\bVersion=["']([^"']+)["']/)?.[1];
  assert.equal(manifestVersion, runtime.storePackageVersion, 'Manifest and Store runtime package versions must match.');
  const databaseCheck = spawnSync('python', [path.join(ROOT, 'scripts', 'verify-store-package-database.py'), artifact], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (databaseCheck.stdout) process.stdout.write(databaseCheck.stdout);
  if (databaseCheck.stderr) process.stderr.write(databaseCheck.stderr);
  assert.equal(databaseCheck.status, 0, 'Store package seed database contains user data or is invalid.');
  console.log(`ATHENA_STORE_PACKAGE_OK file=${path.basename(artifact)} bytes=${fs.statSync(artifact).size}`);
  console.log('ATHENA_STORE_EXTERNAL_REVIEW_REQUIRED private-audience partner-center-certification package-flight');
}

verifySource();
if (process.argv.includes('--source-only')) {
  console.log('ATHENA_STORE_PACKAGE_BLOCKED no Store package supplied');
  process.exit(0);
}
const artifactIndex = process.argv.indexOf('--artifact');
if (artifactIndex < 0 || !process.argv[artifactIndex + 1]) {
  console.error('ATHENA_STORE_PACKAGE_BLOCKED use --artifact <release-store\\*.appx>');
  process.exit(2);
}
verifyArtifact(process.argv[artifactIndex + 1]);
