const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, authenticode, readJson, releaseChannel, sha256, sha512Base64, writeJson } = require('./release-common');

function resolveManifest(argument) {
  if (!argument) throw new Error('Candidate manifest is required. Use --manifest <candidate-manifest.json>.');
  return path.resolve(ROOT, argument);
}

function verifyRecord(record, manifestDirectory) {
  const artifact = path.resolve(manifestDirectory, record.file);
  const allowedRoot = `${path.resolve(manifestDirectory)}${path.sep}`;
  assert(artifact.startsWith(allowedRoot), `Candidate artifact escapes its approved root: ${record.file}`);
  assert(fs.existsSync(artifact), `Candidate artifact is missing: ${record.file}`);
  assert.strictEqual(fs.statSync(artifact).size, record.bytes, `Byte size changed: ${record.file}`);
  assert.strictEqual(sha256(artifact), record.sha256, `SHA-256 changed: ${record.file}`);
  assert.strictEqual(sha512Base64(artifact), record.sha512, `SHA-512 changed: ${record.file}`);
  return artifact;
}

function validSignature(signature, expectedPublisher) {
  return Boolean(
    signature
    && signature.valid === true
    && signature.status === 'Valid'
    && signature.timestampSubject
    && signature.subject
    && signature.subject.toLowerCase() === expectedPublisher.toLowerCase()
  );
}

function verifyManifest(manifestPath, options = {}) {
  const manifest = readJson(manifestPath);
  const manifestDirectory = path.dirname(manifestPath);
  const releaseRoot = options.releaseRoot || path.resolve(manifestDirectory, '..', '..');
  const inspectSignature = options.inspectSignature || authenticode;
  const blockers = [];
  assert.strictEqual(manifest.schemaVersion, 1, 'Unsupported candidate manifest schema.');
  assert.strictEqual(manifest.channel, 'beta', 'Private Beta candidate must use the beta channel.');
  assert.strictEqual(releaseChannel(manifest.version), 'beta', 'Private Beta candidate version must be a beta or rc prerelease.');
  assert.match(manifest.candidateId || '', /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/, 'Candidate ID is invalid.');
  assert(manifest.source?.commit && manifest.source.commit !== 'unknown', 'Candidate source commit is missing.');
  if (!manifest.source.cleanCheckout) blockers.push('clean-checkout-not-proven');

  const expectedPublisher = manifest.signingPolicy?.expectedPublisher || '';
  if (!expectedPublisher) blockers.push('publisher-missing');
  assert((manifest.artifacts || []).length > 0, 'Candidate manifest has no artifacts.');
  for (const artifact of manifest.artifacts || []) {
    const artifactPath = verifyRecord(artifact, manifestDirectory);
    if (artifact.file.toLowerCase().endsWith('.exe') && !validSignature(inspectSignature(artifactPath), expectedPublisher)) {
      blockers.push(`invalid-signature:${artifact.file}`);
    }
  }

  const executables = manifest.executableEvidence || [];
  if (!executables.some(item => item.file === 'win-unpacked/Athena.exe')) blockers.push('main-executable-evidence-missing');
  for (const executable of executables) {
    const executablePath = verifyRecord(executable, releaseRoot);
    if (!validSignature(inspectSignature(executablePath), expectedPublisher)) blockers.push(`invalid-signature:${executable.file}`);
  }
  if (manifest.distributionAllowed !== true || manifest.disposition !== 'CANDIDATE_READY') {
    blockers.push('manifest-distribution-blocked');
  }
  if ((manifest.blockers || []).length > 0) blockers.push('manifest-has-blockers');

  if (options.requireGraduation) {
    const beta = manifest.betaValidation || {};
    const completed = Number(beta.completedParticipants || 0);
    if (beta.status !== 'PASSED') blockers.push('beta-validation-not-passed');
    if (completed < 20 || completed > 50) blockers.push(`participant-count-invalid:${completed}`);
    if (beta.installMatrixStatus !== 'PASSED') blockers.push('install-matrix-not-passed');
    if ((beta.openP0P1Count || 0) !== 0) blockers.push(`open-p0-p1:${beta.openP0P1Count || 0}`);
  }

  return { manifest, blockers: [...new Set(blockers)] };
}

function selfTest() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-private-beta-'));
  try {
    const candidateDirectory = path.join(scratch, 'candidates', 'fixture');
    const executableDirectory = path.join(scratch, 'win-unpacked');
    fs.mkdirSync(candidateDirectory, { recursive: true });
    fs.mkdirSync(executableDirectory, { recursive: true });
    const artifact = path.join(candidateDirectory, 'Athena Setup 0.9.0-beta.1.exe');
    const executable = path.join(executableDirectory, 'Athena.exe');
    fs.writeFileSync(artifact, 'private-beta-fixture', 'utf8');
    fs.writeFileSync(executable, 'private-beta-executable-fixture', 'utf8');
    const signature = { status: 'Valid', valid: true, subject: 'CN=Athena Test', timestampSubject: 'CN=Test Timestamp' };
    const record = {
      file: path.basename(artifact),
      bytes: fs.statSync(artifact).size,
      sha256: sha256(artifact),
      sha512: sha512Base64(artifact),
      authenticode: signature,
    };
    const executableRecord = {
      file: 'win-unpacked/Athena.exe',
      bytes: fs.statSync(executable).size,
      sha256: sha256(executable),
      sha512: sha512Base64(executable),
      authenticode: signature,
    };
    const manifestPath = path.join(candidateDirectory, 'candidate-manifest.json');
    writeJson(manifestPath, {
      schemaVersion: 1,
      candidateId: 'fixture-beta-1',
      version: '0.9.6-beta.1',
      channel: 'beta',
      source: { commit: 'fixture', cleanCheckout: true },
      signingPolicy: { expectedPublisher: 'CN=Athena Test' },
      artifacts: [record],
      executableEvidence: [executableRecord],
      distributionAllowed: true,
      disposition: 'CANDIDATE_READY',
      blockers: [],
      betaValidation: { status: 'NOT_STARTED', completedParticipants: 0 },
    });
    const validOptions = { releaseRoot: scratch, inspectSignature: () => signature };
    assert.deepStrictEqual(verifyManifest(manifestPath, validOptions).blockers, []);
    assert(verifyManifest(manifestPath, { ...validOptions, requireGraduation: true }).blockers.includes('beta-validation-not-passed'));
    const invalidSignature = { ...signature, timestampSubject: null };
    assert(verifyManifest(manifestPath, { ...validOptions, inspectSignature: () => invalidSignature }).blockers.some(item => item.startsWith('invalid-signature:')));
    const validManifest = readJson(manifestPath);
    writeJson(manifestPath, { ...validManifest, version: '0.9.6' });
    assert.throws(() => verifyManifest(manifestPath, validOptions), /version must be a beta/);
    writeJson(manifestPath, { ...validManifest, artifacts: [{ ...record, file: '../outside.exe' }] });
    assert.throws(() => verifyManifest(manifestPath, validOptions), /escapes its approved root/);
    writeJson(manifestPath, { ...validManifest, artifacts: [] });
    assert.throws(() => verifyManifest(manifestPath, validOptions), /no artifacts/);
    writeJson(manifestPath, validManifest);
    fs.appendFileSync(artifact, '-tampered');
    assert.throws(() => verifyManifest(manifestPath, validOptions), /Byte size changed/);
    console.log('ATHENA_PRIVATE_BETA_GATE_OK signedCandidate=verified graduation=fail-closed tamper=blocked');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const manifestIndex = process.argv.indexOf('--manifest');
  const manifestPath = resolveManifest(manifestIndex >= 0 ? process.argv[manifestIndex + 1] : '');
  const requireGraduation = process.argv.includes('--require-graduation');
  const { manifest, blockers } = verifyManifest(manifestPath, { requireGraduation });
  console.log(`ATHENA_PRIVATE_BETA_CANDIDATE candidate=${manifest.candidateId || 'unknown'} distribution=${manifest.distributionAllowed === true} graduation=${requireGraduation}`);
  if (blockers.length) {
    console.error(`ATHENA_PRIVATE_BETA_BLOCKED ${blockers.join(',')}`);
    process.exit(2);
  }
  console.log(requireGraduation ? 'ATHENA_PRIVATE_BETA_GRADUATION_OK' : 'ATHENA_PRIVATE_BETA_DISTRIBUTION_OK');
}

try {
  main();
} catch (error) {
  console.error(`ATHENA_PRIVATE_BETA_VERIFY_FAILED ${error.message}`);
  process.exit(1);
}
