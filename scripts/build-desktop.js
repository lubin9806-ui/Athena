const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, normalizeUpdateBaseUrl, packageMetadata, releaseChannel, signingCredentialsPresent, writeJson } = require('./release-common');
const { main: prepareRelease } = require('./prepare-release');

function run(label, script, args = []) {
  console.log(`ATHENA_BUILD_STEP ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runElectron(label, script) {
  console.log(`ATHENA_BUILD_STEP ${label}`);
  const electronCli = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const result = spawnSync(process.execPath, [electronCli, script], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function effectiveBuilderConfig(signed, updateUrl, channel, publisher) {
  const sourcePath = path.join(ROOT, 'electron-builder.yml');
  let contents = fs.readFileSync(sourcePath, 'utf8');
  if (!contents.includes('signAndEditExecutable: true')) {
    throw new Error('electron-builder.yml must keep release signing enabled in the source configuration.');
  }
  if (!signed) contents = contents.replace('signAndEditExecutable: true', 'signAndEditExecutable: false');
  if (signed) contents = `forceCodeSigning: true\n${contents}`;
  contents = `${contents.trimEnd()}\npublish:\n  provider: generic\n  url: ${JSON.stringify(updateUrl)}\n  channel: ${JSON.stringify(channel)}\n  publisherName:\n    - ${JSON.stringify(publisher)}\n  updaterCacheDirName: athena-updater\n`;
  const target = path.join(ROOT, '.build', 'electron-builder.effective.yml');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
  return target;
}

function main() {
  process.env.CSC_LINK ||= process.env.WINDOWS_CSC_LINK || process.env.WIN_CSC_LINK || '';
  process.env.CSC_KEY_PASSWORD ||= process.env.WINDOWS_CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD || '';
  const requireSigning = process.argv.includes('--require-signing');
  const requireClean = process.argv.includes('--require-clean') || Boolean(process.env.CI);
  const signed = signingCredentialsPresent();
  if (requireSigning && !signed) {
    console.error('ATHENA_RELEASE_EXTERNAL_BLOCKED code-signing-certificate-missing');
    process.exit(2);
  }
  const updateBaseUrl = process.env.ATHENA_UPDATE_BASE_URL?.trim() || '';
  const approvedUpdateBaseUrl = normalizeUpdateBaseUrl(updateBaseUrl);
  const signingPublisher = process.env.ATHENA_SIGNING_PUBLISHER?.trim() || '';
  if (signed && !approvedUpdateBaseUrl) {
    console.error('ATHENA_RELEASE_EXTERNAL_BLOCKED https-update-feed-missing');
    process.exit(3);
  }
  if (signed && !signingPublisher) {
    console.error('ATHENA_RELEASE_EXTERNAL_BLOCKED signing-publisher-identity-missing');
    process.exit(4);
  }
  if (!signed) console.log('ATHENA_RELEASE_EXTERNAL_BLOCKED code-signing-certificate-missing; building unsigned engineering evidence only');

  const originalArgv = process.argv;
  if (requireClean && !originalArgv.includes('--require-clean')) process.argv = [...originalArgv, '--require-clean'];
  prepareRelease();
  process.argv = originalArgv;

  const version = packageMetadata().version;
  const channel = releaseChannel(version);
  writeJson(path.join(ROOT, '.build', 'update-config.json'), {
    schemaVersion: 1,
    enabled: signed && Boolean(approvedUpdateBaseUrl),
    baseUrl: signed ? approvedUpdateBaseUrl || '' : '',
    channel,
    checkIntervalHours: 6,
  });
  const publisher = signingPublisher || 'UNSIGNED ENGINEERING EVIDENCE';
  const escapedPublisher = publisher.replace(/'/g, "''");
  const updateUrl = signed ? approvedUpdateBaseUrl || '' : 'https://updates.invalid/athena-disabled';
  fs.writeFileSync(path.join(ROOT, '.build', 'app-update.yml'), [
    'provider: generic',
    `url: '${updateUrl}'`,
    `channel: ${channel}`,
    'publisherName:',
    `  - '${escapedPublisher}'`,
    'updaterCacheDirName: athena-updater',
    '',
  ].join('\n'), 'utf8');
  const config = effectiveBuilderConfig(signed, updateUrl, channel, publisher);
  run('clean', path.join(ROOT, 'scripts', 'clean-dist.js'));
  run('typecheck', path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'));
  runElectron('seed-database', path.join(ROOT, 'scripts', 'create-seed-database.js'));
  run('renderer', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), ['build', '--config', 'vite.config.mts']);
  run('voice-runtime', path.join(ROOT, 'scripts', 'verify-voice-runtime.js'));
  run('image-runtime-contract', path.join(ROOT, 'scripts', 'verify-image-runtime-contract.js'));
  run('package', path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), ['--config', config, '--publish', 'never']);
  console.log(`ATHENA_DESKTOP_BUILD_OK signed=${signed}`);
}

main();
