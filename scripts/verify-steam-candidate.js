const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { authenticode, ROOT } = require('./release-common');

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  assert.equal(header.toString('hex', 0, 8), '89504e470d0a1a0a', `${filePath} is not PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function requirePng(relative, width, height) {
  const filePath = path.join(ROOT, relative);
  assert(fs.existsSync(filePath), `Missing Steam asset: ${relative}`);
  assert.deepEqual(pngDimensions(filePath), { width, height }, `Steam asset dimensions drifted: ${relative}`);
}

function requireScreenshotPng(relative) {
  const filePath = path.join(ROOT, relative);
  assert(fs.existsSync(filePath), `Missing Steam screenshot: ${relative}`);
  const dimensions = pngDimensions(filePath);
  assert(dimensions.width >= 1920 && dimensions.height >= 1080, `Steam screenshot is below 1920x1080: ${relative}`);
  assert(Math.abs((dimensions.width / dimensions.height) - (16 / 9)) < 0.01, `Steam screenshot is not 16:9: ${relative}`);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function verifySource() {
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'steam.json'), 'utf8'));
  assert.equal(product.skuId, 'athena-steam-personal-v1');
  assert.equal(product.appId, null);
  assert.equal(product.depotId, null);
  assert.equal(product.externalPayments, false);
  assert.equal(product.cloud.enabled, false);
  assert.equal(product.cloud.approval.status, 'not-approved');
  assert.deepEqual(product.cloud.entries, []);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.optionalDependencies?.['steamworks.js'], '0.4.0');
  assert.equal(pkg.scripts?.['build:steam'], 'node scripts/build-steam.js --require-signing --require-clean');

  const expected = [
    ['assets/steam/store/header_capsule.png', 920, 430],
    ['assets/steam/store/small_capsule.png', 462, 174],
    ['assets/steam/store/main_capsule.png', 1232, 706],
    ['assets/steam/store/vertical_capsule.png', 748, 896],
    ['assets/steam/library/library_capsule.png', 600, 900],
    ['assets/steam/library/library_header.png', 920, 430],
    ['assets/steam/library/library_hero.png', 3840, 1240],
    ['assets/steam/community/shortcut_icon_256.png', 256, 256],
    ['assets/steam/community/app_icon_184.png', 184, 184],
  ];
  for (const [relative, width, height] of expected) requirePng(relative, width, height);

  const logoPath = path.join(ROOT, 'assets/steam/library/library_logo.png');
  assert(fs.existsSync(logoPath), 'Missing transparent Steam library logo.');
  const logoHeader = fs.readFileSync(logoPath).subarray(0, 26);
  assert.equal(logoHeader[25], 6, 'Steam library logo must be RGBA PNG.');

  const screenshotDirectory = path.join(ROOT, 'assets', 'steam', 'screenshots');
  const screenshots = fs.readdirSync(screenshotDirectory).filter(name => /^\d\d-[a-z-]+\.png$/i.test(name)).sort();
  assert.equal(screenshots.length, 5, 'Steam store requires exactly five reviewed screenshot candidates in this source set.');
  assert(!screenshots.some(name => /memory|settings|execution/i.test(name)), 'Screenshot candidates must not expose personal data or excluded capability panels.');
  for (const name of screenshots) requireScreenshotPng(`assets/steam/screenshots/${name}`);

  for (const relative of [
    'docs/steam/STEAM_1_0_POLICY.md',
    'docs/steam/STEAM_AI_CONTENT_DISCLOSURE.md',
    'docs/steam/STEAM_STORE_LISTING.md',
    'docs/steam/STEAM_ASSET_MANIFEST.md',
    'docs/steam/STEAM_GO_NO_GO.md',
  ]) assert(fs.existsSync(path.join(ROOT, relative)), `Missing Steam release document: ${relative}`);

  const mainSource = fs.readFileSync(path.join(ROOT, 'src', 'app', 'main.ts'), 'utf8');
  assert.match(mainSource, /isSteamExternalNavigationAllowed/);
  assert.match(
    mainSource,
    /!isSmokeTest && !isSteamBuild && !isMicrosoftStoreBuild\) initializeDesktopUpdater\(mainWindow\)/,
    'Desktop updater must stay disabled for Steam and Microsoft Store builds.',
  );
  const toolsSource = fs.readFileSync(path.join(ROOT, 'src', 'core', 'tools', 'ComputerTools.ts'), 'utf8');
  assert.match(toolsSource, /isSteamToolAllowed/);
  const builderSource = fs.readFileSync(path.join(ROOT, 'electron-builder.steam.yml'), 'utf8');
  assert.match(builderSource, /!assets\/steam\/\*\*\/\*/);
  assert.match(builderSource, /!node_modules\/steamworks\.js\/dist\/win64\/\*\.lib/);
  console.log('ATHENA_STEAM_NEAR_FINAL_SOURCE_OK');
}

function verifyCandidate(candidateRoot) {
  const root = path.resolve(candidateRoot);
  const exe = path.join(root, 'AthenaSteam.exe');
  const resources = path.join(root, 'resources');
  for (const required of [
    exe,
    path.join(resources, 'app.asar'),
    path.join(resources, 'steam', 'steam-runtime.json'),
    path.join(resources, 'steam', 'steam-product.json'),
    path.join(resources, 'app.asar.unpacked', 'node_modules', 'steamworks.js', 'dist', 'win64', 'steam_api64.dll'),
    path.join(resources, 'app.asar.unpacked', 'node_modules', 'steamworks.js', 'dist', 'win64', 'steamworksjs.win32-x64-msvc.node'),
  ]) assert(fs.existsSync(required), `Steam candidate missing: ${required}`);

  assert(!fs.existsSync(path.join(resources, 'app-update.yml')), 'Steam candidate must not package Desktop direct updater config.');
  assert.equal(walk(root).filter(file => path.basename(file).toLowerCase() === 'steam_appid.txt').length, 0, 'steam_appid.txt must not ship in the depot.');
  const runtime = JSON.parse(fs.readFileSync(path.join(resources, 'steam', 'steam-runtime.json'), 'utf8'));
  assert.equal(runtime.skuId, 'athena-steam-personal-v1');
  assert(Number.isSafeInteger(runtime.appId) && runtime.appId > 0 && runtime.appId !== 480, 'Candidate must contain the real Athena AppID, never Spacewar 480.');
  assert(Number.isSafeInteger(runtime.depotId) && runtime.depotId > 0 && runtime.depotId !== runtime.appId, 'Candidate DepotID is invalid.');
  assert(runtime.buildBranch && runtime.buildBranch !== 'default', 'Candidate must target a private test branch before review.');
  assert.equal(runtime.cloudEnabled, false, 'Steam Cloud must remain disabled until window 03 approves a non-empty whitelist.');
  const signature = authenticode(exe);
  assert(signature.valid && signature.timestampSubject, `AthenaSteam.exe is not validly signed and timestamped: ${signature.status}`);
  console.log(`ATHENA_STEAM_NEAR_FINAL_ARTIFACT_OK appId=${runtime.appId} depotId=${runtime.depotId} branch=${runtime.buildBranch}`);
  console.log('ATHENA_STEAM_NEAR_FINAL_EXTERNAL_CHECK_REQUIRED launch-from-owned-steam-account clean-machine branch-upload valve-review');
}

verifySource();
if (process.argv.includes('--source-only')) {
  console.log('ATHENA_STEAM_NEAR_FINAL_BLOCKED no real Steam candidate supplied');
  process.exit(0);
}
const candidateIndex = process.argv.indexOf('--candidate');
if (candidateIndex < 0 || !process.argv[candidateIndex + 1]) {
  console.error('ATHENA_STEAM_NEAR_FINAL_BLOCKED use --candidate <release-steam\\win-unpacked> after real AppID build');
  process.exit(2);
}
verifyCandidate(process.argv[candidateIndex + 1]);
