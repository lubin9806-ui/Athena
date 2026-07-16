const fs = require('fs');
const path = require('path');
const {
  ROOT,
  buildInputHash,
  buildTime,
  packageMetadata,
  releaseChannel,
  signingCredentialsPresent,
  sourceState,
  writeJson,
} = require('./release-common');

function main() {
  const pkg = packageMetadata();
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error(`Version mismatch: package=${pkg.version}, lock=${lock.version}, lock-root=${lock.packages?.['']?.version}`);
  }

  const state = sourceState();
  if (process.argv.includes('--require-clean') && !state.cleanCheckout) {
    throw new Error(`Release build requires a clean checkout; ${state.changedPathCount} changed paths were detected.`);
  }

  const info = {
    schemaVersion: 1,
    product: 'Athena Desktop',
    version: pkg.version,
    channel: releaseChannel(pkg.version),
    commit: state.commit,
    shortCommit: state.shortCommit,
    buildInputSha256: buildInputHash(),
    builtAt: buildTime(),
    cleanCheckout: state.cleanCheckout,
    signingCredentialsDetected: signingCredentialsPresent(),
  };
  writeJson(path.join(ROOT, '.build', 'build-info.json'), info);
  console.log(`ATHENA_BUILD_INFO_OK version=${info.version} channel=${info.channel} commit=${info.shortCommit} input=${info.buildInputSha256}`);
  if (!info.cleanCheckout) console.log(`ATHENA_BUILD_SOURCE_DIRTY paths=${state.changedPathCount}`);
  return info;
}

if (require.main === module) main();
module.exports = { main };
