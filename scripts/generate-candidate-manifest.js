const fs = require('fs');
const path = require('path');
const {
  ROOT,
  authenticode,
  buildInputHash,
  buildTime,
  packageMetadata,
  readJson,
  releaseChannel,
  sha256,
  sha512Base64,
  sourceState,
  writeJson,
} = require('./release-common');

function artifactRecord(filePath, candidateRoot, executable = false) {
  const stats = fs.statSync(filePath);
  const signature = executable ? authenticode(filePath) : null;
  return {
    file: path.relative(candidateRoot, filePath).replace(/\\/g, '/'),
    bytes: stats.size,
    sha256: sha256(filePath),
    sha512: sha512Base64(filePath),
    ...(signature ? { authenticode: signature } : {}),
  };
}

function packagedExecutables(root) {
  const executables = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        executables.push({
          ...artifactRecord(absolute, path.join(ROOT, 'release'), true),
          file: path.relative(path.join(ROOT, 'release'), absolute).replace(/\\/g, '/'),
        });
      }
    }
  };
  visit(root);
  return executables.sort((left, right) => left.file.localeCompare(right.file));
}

function main() {
  const pkg = packageMetadata();
  if (releaseChannel(pkg.version) !== 'beta') {
    throw new Error(`Private Beta candidate generation requires a beta version, received ${pkg.version}.`);
  }
  const installerName = `Athena Setup ${pkg.version}.exe`;
  const sourceInstaller = path.join(ROOT, 'release', installerName);
  const sourceBlockmap = `${sourceInstaller}.blockmap`;
  const sourceApp = path.join(ROOT, 'release', 'win-unpacked', 'Athena.exe');
  for (const required of [sourceInstaller, sourceBlockmap, sourceApp]) {
    if (!fs.existsSync(required)) throw new Error(`Candidate artifact missing: ${required}`);
  }

  const buildInfoPath = path.join(ROOT, '.build', 'build-info.json');
  const buildInfo = fs.existsSync(buildInfoPath) ? readJson(buildInfoPath) : null;
  if (!buildInfo || buildInfo.version !== pkg.version) throw new Error('Build info is missing or does not match package version. Run npm.cmd run build first.');
  if (buildInfo.buildInputSha256 !== buildInputHash()) throw new Error('Source inputs changed after the build. Rebuild before generating a candidate manifest.');

  const state = sourceState();
  const candidateId = `${pkg.version}-${state.shortCommit}-${buildInfo.buildInputSha256.slice(0, 12).toLowerCase()}`;
  const candidateRoot = path.join(ROOT, 'release', 'candidates', candidateId);
  fs.mkdirSync(candidateRoot, { recursive: true });
  const installer = path.join(candidateRoot, installerName);
  const blockmap = `${installer}.blockmap`;
  fs.copyFileSync(sourceInstaller, installer);
  fs.copyFileSync(sourceBlockmap, blockmap);
  fs.copyFileSync(path.join(ROOT, 'docs', 'THIRD_PARTY_NOTICES.md'), path.join(candidateRoot, 'THIRD_PARTY_NOTICES.md'));

  const artifacts = [
    artifactRecord(installer, candidateRoot, true),
    artifactRecord(blockmap, candidateRoot, false),
  ];
  const executableEvidence = packagedExecutables(path.join(ROOT, 'release', 'win-unpacked'));
  const packagedAppEvidence = {
    ...executableEvidence.find(item => item.file === 'win-unpacked/Athena.exe'),
    smokeRequired: ['ATHENA_SMOKE_READY_TO_SHOW', 'ATHENA_SMOKE_DOM_OK'],
  };
  const updaterConfig = fs.readFileSync(path.join(ROOT, '.build', 'app-update.yml'), 'utf8');
  const expectedPublisher = updaterConfig.match(/^\s*-\s*'([^']+)'\s*$/m)?.[1]?.replace(/''/g, "'") || '';
  const invalidSignatures = [...artifacts, ...executableEvidence]
    .filter(item => item.authenticode && (
      !item.authenticode.valid
      || !item.authenticode.timestampSubject
      || !expectedPublisher
      || item.authenticode.subject?.toLowerCase() !== expectedPublisher.toLowerCase()
    ));
  const blockers = [];
  if (invalidSignatures.length > 0) blockers.push({
    type: 'external',
    code: 'CODE_SIGNING_CERTIFICATE_MISSING_OR_INVALID',
    detail: 'Installer and executable must have a Valid Authenticode signature and timestamp before distribution.',
  });
  if (!buildInfo.cleanCheckout) blockers.push({
    type: 'engineering',
    code: 'CLEAN_CHECKOUT_NOT_PROVEN',
    detail: 'This local candidate was built from a working tree with uncommitted paths; CI must rebuild it from checkout.',
  });

  const manifest = {
    schemaVersion: 1,
    candidateId,
    product: 'Athena Desktop',
    version: pkg.version,
    channel: releaseChannel(pkg.version),
    generatedAt: buildTime(),
    source: {
      commit: buildInfo.commit,
      shortCommit: buildInfo.shortCommit,
      cleanCheckout: buildInfo.cleanCheckout,
      buildInputSha256: buildInfo.buildInputSha256,
    },
    signingPolicy: {
      expectedPublisher,
      requiresAuthenticodeStatus: 'Valid',
      requiresTimestamp: true,
    },
    artifacts,
    packagedAppEvidence,
    executableEvidence,
    distributionAllowed: blockers.length === 0,
    disposition: blockers.length === 0 ? 'CANDIDATE_READY' : 'BLOCKED',
    blockers,
    betaValidation: {
      requiredParticipants: { minimum: 20, maximum: 50 },
      completedParticipants: 0,
      status: 'NOT_STARTED',
      issue: 'ATH-DESKTOP-001',
    },
  };
  const manifestPath = path.join(candidateRoot, 'candidate-manifest.json');
  writeJson(manifestPath, manifest);
  console.log(`ATHENA_CANDIDATE_MANIFEST_OK ${manifestPath}`);
  for (const blocker of blockers) console.log(`ATHENA_CANDIDATE_BLOCKED ${blocker.code}`);
}

main();
