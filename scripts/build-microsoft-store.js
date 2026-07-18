const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, packageMetadata, sourceState, writeJson } = require('./release-common');
const { main: prepareRelease } = require('./prepare-release');

function fail(code, message) {
  console.error(`ATHENA_STORE_BUILD_BLOCKED ${code} ${message}`);
  process.exit(2);
}

function run(label, executable, args, env = process.env) {
  console.log(`ATHENA_STORE_BUILD_STEP ${label}`);
  const result = spawnSync(executable, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, env });
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'microsoft-store.json'), 'utf8'));
  if (product.releaseStage !== 'private-beta-draft' || product.audience !== 'private') {
    fail('audience-not-private', 'The first Store candidate must remain a private audience draft.');
  }
  if (product.externalPayments !== false || product.updatesManagedBy !== 'microsoft-store') {
    fail('store-policy-drift', 'Store SKU must exclude external payments and use Microsoft Store updates.');
  }
  const betaNumber = packageMetadata().version.match(/-(?:beta|rc)\.(\d+)$/)?.[1] || '1';
  const storeBuildNumber = process.env.ATHENA_STORE_BUILD_NUMBER?.trim() || betaNumber;
  if (!/^\d+$/.test(storeBuildNumber) || Number(storeBuildNumber) < 1 || Number(storeBuildNumber) > 65535) {
    fail('build-number-invalid', 'ATHENA_STORE_BUILD_NUMBER must be an integer from 1 through 65535.');
  }
  const storeAppVersion = `0.9.${storeBuildNumber}`;
  const storePackageVersion = `${storeAppVersion}.0`;
  const requireClean = process.argv.includes('--require-clean') || Boolean(process.env.CI);
  const state = sourceState();
  if (requireClean && !state.cleanCheckout) fail('dirty-checkout', 'Microsoft Store package builds require a clean checkout.');

  const originalArgv = process.argv;
  if (requireClean && !originalArgv.includes('--require-clean')) process.argv = [...originalArgv, '--require-clean'];
  const buildInfo = prepareRelease();
  process.argv = originalArgv;
  writeJson(path.join(ROOT, '.build', 'build-info.json'), {
    ...buildInfo,
    product: product.productName,
    skuId: product.skuId,
    storeId: product.storeId,
    identityName: product.identityName,
    packageFamilyName: product.packageFamilyName,
    updatesManagedBy: product.updatesManagedBy,
    storePackageVersion,
  });
  writeJson(path.join(ROOT, '.build', 'store', 'store-runtime.json'), {
    schemaVersion: 1,
    skuId: product.skuId,
    storeId: product.storeId,
    identityName: product.identityName,
    packageFamilyName: product.packageFamilyName,
    audience: product.audience,
    updatesManagedBy: product.updatesManagedBy,
    storePackageVersion,
    generatedAt: new Date().toISOString(),
  });

  const node = process.execPath;
  const electronBuilderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(electronBuilderCli)) fail('electron-builder-missing', 'Unable to locate electron-builder for the SQLite ABI and package steps.');
  run('assets', 'powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', path.join(ROOT, 'scripts', 'prepare-store-assets.ps1')]);
  run('clean', node, [path.join(ROOT, 'scripts', 'clean-dist.js')]);
  run('typecheck', node, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')]);
  run('sqlite-electron-abi', node, [electronBuilderCli, 'install-app-deps', '--platform', 'win32', '--arch', 'x64']);
  run('seed-database', node, [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), path.join(ROOT, 'scripts', 'create-seed-database.js')]);
  run('renderer', node, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.mts']);
  run('package', node, [
    electronBuilderCli,
    '--config', 'electron-builder.store.yml',
    `--config.extraMetadata.version=${storeAppVersion}`,
    '--win', 'appx', '--x64', '--publish', 'never',
  ], {
    ...process.env,
    ATHENA_SKU: 'microsoft-store',
  });
  console.log(`ATHENA_STORE_BUILD_OK storeId=${product.storeId} identity=${product.identityName} audience=${product.audience} packageVersion=${storePackageVersion}`);
  console.log('ATHENA_STORE_NOT_SUBMITTED Partner Center upload and certification remain external actions.');
}

main();
