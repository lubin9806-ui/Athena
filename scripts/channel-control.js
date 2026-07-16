const fs = require('fs');
const path = require('path');
const { authenticode, readJson, releaseChannel, sha256, writeJson } = require('./release-common');

function assertChannel(channel) {
  if (!['beta', 'stable'].includes(channel)) throw new Error(`Unsupported channel: ${channel}`);
}

function loadEligibleCandidate(manifestPath, expectedChannel, options = {}) {
  const manifest = readJson(manifestPath);
  assertChannel(expectedChannel);
  if (manifest.channel !== expectedChannel || releaseChannel(manifest.version) !== expectedChannel) {
    throw new Error(`Candidate ${manifest.version} does not belong to ${expectedChannel}.`);
  }
  if (manifest.betaValidation?.status === 'PASSED' && manifest.betaValidation.completedParticipants < 20) {
    throw new Error('A Beta pass cannot be recorded with fewer than 20 completed participants.');
  }
  const root = path.dirname(manifestPath);
  for (const artifact of manifest.artifacts || []) {
    const artifactPath = path.resolve(root, artifact.file);
    if (!artifactPath.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(artifactPath)) {
      throw new Error(`Candidate artifact is missing or outside its directory: ${artifact.file}`);
    }
    if (sha256(artifactPath) !== artifact.sha256) throw new Error(`Candidate hash mismatch: ${artifact.file}`);
    if (/\.exe$/i.test(artifact.file)) {
      if (options.allowFixture && manifest.fixture === true) continue;
      const signature = authenticode(artifactPath);
      if (!signature.valid || !signature.timestampSubject) {
        throw new Error(`Authenticode or timestamp is not Valid for ${artifact.file}: ${signature.status}`);
      }
    }
  }
  if (!options.allowFixture && manifest.distributionAllowed !== true) {
    throw new Error(`Candidate is blocked: ${(manifest.blockers || []).map(item => item.code).join(', ')}`);
  }
  return manifest;
}

function stageCandidate(feedRoot, channel, manifestPath, options = {}) {
  const manifest = loadEligibleCandidate(manifestPath, channel, options);
  const channelRoot = path.join(feedRoot, 'channels', channel);
  const candidateRoot = path.join(channelRoot, 'candidates', manifest.candidateId);
  fs.mkdirSync(candidateRoot, { recursive: true });
  const sourceRoot = path.dirname(manifestPath);
  for (const artifact of manifest.artifacts || []) {
    fs.copyFileSync(path.join(sourceRoot, artifact.file), path.join(candidateRoot, path.basename(artifact.file)));
  }
  const publishedManifest = {
    ...manifest,
    artifacts: (manifest.artifacts || [])
      .map(item => ({ ...item, file: `candidates/${manifest.candidateId}/${path.basename(item.file)}` })),
  };
  writeJson(path.join(candidateRoot, 'candidate-manifest.json'), publishedManifest);
  writeJson(path.join(channelRoot, 'latest.json'), publishedManifest);
  if (!options.rollback) {
    const previousRollback = path.join(channelRoot, 'rollback.json');
    if (fs.existsSync(previousRollback)) fs.rmSync(previousRollback, { force: true });
  }
  const installer = publishedManifest.artifacts.find(item => /\.exe$/i.test(item.file));
  if (!installer?.sha512) throw new Error('Candidate installer is missing SHA-512 update metadata.');
  const updateMetadata = [
    `version: ${publishedManifest.version}`,
    'files:',
    `  - url: ${installer.file.replace(/\\/g, '/')}`,
    `    sha512: ${installer.sha512}`,
    `    size: ${installer.bytes}`,
    `path: ${installer.file.replace(/\\/g, '/')}`,
    `sha512: ${installer.sha512}`,
    `releaseDate: '${publishedManifest.generatedAt || new Date().toISOString()}'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(channelRoot, `${channel}.yml`), updateMetadata, 'utf8');
  if (!fs.existsSync(path.join(channelRoot, 'control.json'))) {
    writeJson(path.join(channelRoot, 'control.json'), { schemaVersion: 1, channel, paused: false, reason: null, updatedAt: new Date().toISOString() });
  }
  return publishedManifest;
}

function setPaused(feedRoot, channel, paused, reason) {
  assertChannel(channel);
  if (paused && !reason?.trim()) throw new Error('A pause requires a reason.');
  const channelRoot = path.join(feedRoot, 'channels', channel);
  fs.mkdirSync(channelRoot, { recursive: true });
  const control = {
    schemaVersion: 1,
    channel,
    paused,
    reason: paused ? reason.trim() : null,
    updatedAt: new Date().toISOString(),
  };
  writeJson(path.join(channelRoot, 'control.json'), control);
  return control;
}

function rollback(feedRoot, channel, manifestPath, reason, options = {}) {
  if (!reason?.trim()) throw new Error('Rollback requires an incident or reason.');
  const target = stageCandidate(feedRoot, channel, manifestPath, { ...options, rollback: true });
  const channelRoot = path.join(feedRoot, 'channels', channel);
  writeJson(path.join(channelRoot, 'rollback.json'), {
    schemaVersion: 1,
    channel,
    targetCandidateId: target.candidateId,
    targetVersion: target.version,
    reason: reason.trim(),
    updatedAt: new Date().toISOString(),
  });
  setPaused(feedRoot, channel, false, '');
  return target;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    values[key] = rest[index + 1];
  }
  return values;
}

function cli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command) throw new Error('Usage: channel-control.js <stage|pause|resume|rollback> --feed <dir> --channel <beta|stable> ...');
  if (args.command === 'stage') stageCandidate(args.feed, args.channel, args.manifest);
  else if (args.command === 'pause') setPaused(args.feed, args.channel, true, args.reason);
  else if (args.command === 'resume') setPaused(args.feed, args.channel, false, '');
  else if (args.command === 'rollback') rollback(args.feed, args.channel, args.manifest, args.reason);
  else throw new Error(`Unknown channel command: ${args.command}`);
  console.log(`ATHENA_CHANNEL_CONTROL_OK command=${args.command} channel=${args.channel}`);
}

if (require.main === module) {
  try { cli(); } catch (error) { console.error(`ATHENA_CHANNEL_CONTROL_FAILED ${error.message}`); process.exit(1); }
}

module.exports = { loadEligibleCandidate, rollback, setPaused, stageCandidate };
