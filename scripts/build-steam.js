const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ROOT,
  packageMetadata,
  signingCredentialsPresent,
  sourceState,
  writeJson,
} = require('./release-common');
const { main: prepareRelease } = require('./prepare-release');

function fail(code, message) {
  console.error(`ATHENA_STEAM_BUILD_BLOCKED ${code} ${message}`);
  process.exit(2);
}

function requireSteamId(name) {
  const raw = process.env[name]?.trim();
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) {
    fail(name.toLowerCase(), `${name} must be supplied by the real Steamworks release environment.`);
  }
  return value;
}

function run(label, executable, args) {
  console.log(`ATHENA_STEAM_BUILD_STEP ${label}`);
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ATHENA_SKU: 'steam' },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function effectiveBuilderConfig(signed) {
  const source = path.join(ROOT, 'electron-builder.steam.yml');
  let contents = fs.readFileSync(source, 'utf8');
  if (!contents.includes('signAndEditExecutable: true')) throw new Error('Steam builder source must keep signing enabled.');
  if (!signed) contents = contents.replace('signAndEditExecutable: true', 'signAndEditExecutable: false');
  if (signed) contents = `forceCodeSigning: true\n${contents}`;
  const target = path.join(ROOT, '.build', 'steam', 'electron-builder.effective.yml');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
  return target;
}

function replaceTemplate(sourceName, outputName, values) {
  let contents = fs.readFileSync(path.join(ROOT, 'steamworks', sourceName), 'utf8');
  for (const [name, value] of Object.entries(values)) {
    contents = contents.replaceAll(`{{${name}}}`, String(value).replace(/\\/g, '\\\\'));
  }
  if (/\{\{[A-Z_]+\}\}/.test(contents)) throw new Error(`${sourceName} contains unresolved SteamPipe tokens.`);
  const output = path.join(ROOT, '.build', 'steamworks', outputName);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, contents, 'utf8');
  return output;
}

function main() {
  const appId = requireSteamId('ATHENA_STEAM_APP_ID');
  const depotId = requireSteamId('ATHENA_STEAM_DEPOT_ID');
  if (appId === 480) fail('spacewar-appid-forbidden', 'Valve Spacewar AppID 480 is not Athena ownership evidence.');
  if (appId === depotId) fail('depot-id-invalid', 'AppID and DepotID must be distinct real Steamworks IDs.');

  const branch = process.env.ATHENA_STEAM_TEST_BRANCH?.trim() || 'steam-internal';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(branch) || branch === 'default') {
    fail('test-branch-invalid', 'ATHENA_STEAM_TEST_BRANCH must be a private non-default branch name.');
  }
  const sdkPath = process.env.STEAMWORKS_SDK_PATH?.trim();
  const steamCmd = sdkPath ? path.join(sdkPath, 'tools', 'ContentBuilder', 'builder', 'steamcmd.exe') : '';
  if (!steamCmd || !fs.existsSync(steamCmd)) {
    fail('steamworks-sdk-missing', 'STEAMWORKS_SDK_PATH must point to the real Steamworks SDK used for SteamPipe.');
  }
  for (const bridgeFile of ['steam_api64.dll', 'steamworksjs.win32-x64-msvc.node']) {
    const bridgePath = path.join(ROOT, 'node_modules', 'steamworks.js', 'dist', 'win64', bridgeFile);
    if (!fs.existsSync(bridgePath)) fail('steamworks-native-bridge-missing', `${bridgeFile} is required for the Steam SKU.`);
  }

  const requireClean = process.argv.includes('--require-clean') || Boolean(process.env.CI);
  const state = sourceState();
  if (requireClean && !state.cleanCheckout) fail('dirty-checkout', 'Steam candidate builds require a clean checkout.');
  const signed = signingCredentialsPresent();
  if (process.argv.includes('--require-signing') && !signed) fail('code-signing-missing', 'Near-final Steam candidate requires signing credentials.');
  if (!signed) console.log('ATHENA_STEAM_BUILD_BLOCKED code-signing-missing; unsigned engineering evidence only');

  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'steam.json'), 'utf8'));
  if (product.cloud.approval.status !== 'approved' && (product.cloud.enabled || product.cloud.entries.length > 0)) {
    fail('cloud-window03-approval-missing', 'Steam Cloud cannot contain data before a window 03 approval amendment.');
  }
  const cloudEnabled = product.cloud.enabled === true && product.cloud.approval.status === 'approved' && product.cloud.entries.length > 0;

  const originalArgv = process.argv;
  if (requireClean && !originalArgv.includes('--require-clean')) process.argv = [...originalArgv, '--require-clean'];
  const buildInfo = prepareRelease();
  process.argv = originalArgv;
  writeJson(path.join(ROOT, '.build', 'build-info.json'), {
    ...buildInfo,
    product: 'Athena Steam',
    skuId: product.skuId,
    steamAppId: appId,
    steamDepotId: depotId,
    steamTestBranch: branch,
  });
  writeJson(path.join(ROOT, '.build', 'steam', 'steam-runtime.json'), {
    schemaVersion: 1,
    skuId: product.skuId,
    appId,
    depotId,
    buildBranch: branch,
    cloudEnabled,
    generatedAt: new Date().toISOString(),
  });

  const node = process.execPath;
  run('clean', node, [path.join(ROOT, 'scripts', 'clean-dist.js')]);
  run('typecheck', node, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')]);
  run('seed-database', node, [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), path.join(ROOT, 'scripts', 'create-seed-database.js')]);
  run('renderer', node, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.mts']);
  run('package', node, [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--config', effectiveBuilderConfig(signed), '--dir', '--publish', 'never']);

  const contentRoot = path.join(ROOT, 'release-steam', 'win-unpacked');
  const buildOutput = path.join(ROOT, '.build', 'steampipe-output');
  const values = {
    APP_ID: appId,
    DEPOT_ID: depotId,
    VERSION: packageMetadata().version,
    COMMIT: state.shortCommit,
    CONTENT_ROOT: contentRoot,
    BUILD_OUTPUT: buildOutput,
  };
  replaceTemplate('depot_build_athena.vdf.template', 'depot_build_athena.vdf', values);
  replaceTemplate('app_build_athena.vdf.template', 'app_build_athena.vdf', values);
  console.log(`ATHENA_STEAM_BUILD_OK appId=${appId} depotId=${depotId} branch=${branch} signed=${signed} cloud=${cloudEnabled}`);
  console.log(`ATHENA_STEAMPIPE_READY steamcmd=${steamCmd} script=${path.join(ROOT, '.build', 'steamworks', 'app_build_athena.vdf')}`);
  console.log('ATHENA_STEAMPIPE_NOT_UPLOADED no external upload is performed by build-steam.js');
}

main();
