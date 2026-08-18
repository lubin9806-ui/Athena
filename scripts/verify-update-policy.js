const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const policy = require('../dist/core/update/UpdatePolicy.js');

const NOW = '2026-08-18T00:00:00.000Z';

function control(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: 'beta',
    paused: false,
    reason: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function rollback(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: 'beta',
    targetVersion: '0.9.6-beta.1',
    targetCandidateId: '0.9.6-beta.1-fixture',
    reason: 'Incident rollback',
    updatedAt: NOW,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateId: '0.9.6-beta.2-fixture',
    version: '0.9.6-beta.2',
    channel: 'beta',
    generatedAt: NOW,
    distributionAllowed: true,
    disposition: 'CANDIDATE_READY',
    blockers: [],
    ...overrides,
  };
}

function verifyVersions() {
  assert.equal(policy.channelForVersion('0.9.6-beta.1'), 'beta');
  assert.equal(policy.channelForVersion('0.9.6-rc.1'), 'beta');
  assert.equal(policy.channelForVersion('0.9.6'), 'stable');
  assert.equal(policy.channelForVersion('v0.9.6'), null);
  assert.equal(policy.channelForVersion('0.9.6-alpha.1'), null);
  assert.equal(policy.compareVersions('0.9.6-beta.2', '0.9.6-beta.1'), 1);
  assert.equal(policy.compareVersions('0.9.6-rc.1', '0.9.6-beta.99'), 1);
  assert.equal(policy.compareVersions('0.9.6', '0.9.6-rc.9'), 1);
  assert.equal(policy.compareVersions('0.9.6', '0.9.6'), 0);
  assert.equal(policy.compareVersions('999999.0.0', '0.9.6'), null);
}

function verifyConfiguration() {
  const valid = policy.parseUpdateConfiguration({
    schemaVersion: 1,
    enabled: true,
    baseUrl: 'https://updates.example.test/athena/',
    channel: 'beta',
    checkIntervalHours: 6,
  });
  assert.equal(valid.baseUrl, 'https://updates.example.test/athena');
  assert.equal(policy.parseUpdateConfiguration({ ...valid, schemaVersion: 2 }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'http://updates.example.test' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'https://user:pass@updates.example.test' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'https://updates.example.test/a/%2e%2e/b' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'https://updates.example.test/a/../b' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'https://updates.example.test:444/a' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: ' https://updates.example.test/a' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, baseUrl: 'https:\\updates.example.test\\a' }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, unexpected: true }), null);
  assert.equal(policy.parseUpdateConfiguration({ ...valid, checkIntervalHours: 0.1 }), null);
  assert.deepEqual(policy.parseUpdateConfiguration({ ...valid, enabled: false, baseUrl: 'not-a-url' }), {
    ...valid,
    enabled: false,
    baseUrl: '',
  });

  assert.equal(policy.isApprovedRemoteUrl(valid.baseUrl, 'https://updates.example.test/athena/channels/beta/control.json'), true);
  assert.equal(policy.isApprovedRemoteUrl(valid.baseUrl, 'https://updates.example.test/other/control.json'), false);
  assert.equal(policy.isApprovedRemoteUrl(valid.baseUrl, 'https://cdn.example.test/athena/channels/beta/control.json'), false);
  assert.equal(policy.isApprovedRemoteUrl(valid.baseUrl, 'https://updates.example.test/athena-malicious/control.json'), false);
}

function verifyControls() {
  assert(policy.parseChannelControl(control(), 'beta'));
  assert(policy.parseChannelControl(control({ paused: true, reason: 'QA pause' }), 'beta'));
  assert.equal(policy.parseChannelControl(control({ channel: 'stable' }), 'beta'), null);
  assert.equal(policy.parseChannelControl(control({ paused: true, reason: '' }), 'beta'), null);
  assert.equal(policy.parseChannelControl(control({ updatedAt: 'not-a-date' }), 'beta'), null);
  assert.equal(policy.parseChannelControl(control({ extra: 'rejected' }), 'beta'), null);

  assert(policy.parseRollbackControl(rollback(), 'beta'));
  assert.equal(policy.parseRollbackControl(rollback({ targetVersion: '0.9.5' }), 'beta'), null);
  assert.equal(policy.parseRollbackControl(rollback({ targetCandidateId: '../escape' }), 'beta'), null);
  assert.equal(policy.parseRollbackControl(rollback({ reason: '' }), 'beta'), null);
  assert.equal(policy.parseRollbackControl(rollback({ schemaVersion: 2 }), 'beta'), null);
  assert.equal(policy.parseRollbackControl(rollback({ extra: 'rejected' }), 'beta'), null);

  assert(policy.parsePublishedCandidate(candidate(), 'beta'));
  assert.equal(policy.parsePublishedCandidate(candidate({ version: '0.9.6' }), 'beta'), null);
  assert.equal(policy.parsePublishedCandidate(candidate({ distributionAllowed: false }), 'beta'), null);
  assert.equal(policy.parsePublishedCandidate(candidate({ disposition: 'BLOCKED' }), 'beta'), null);
  assert.equal(policy.parsePublishedCandidate(candidate({ blockers: [{ code: 'blocked' }] }), 'beta'), null);
}

function verifyDecisions() {
  assert.deepEqual(
    policy.evaluateOfferedVersion('0.9.6-beta.1', '0.9.6-beta.2', 'beta', null),
    { approved: true, allowDowngrade: false, reason: 'approved-upgrade' },
  );
  assert.equal(policy.evaluateOfferedVersion('0.9.6-beta.2', '0.9.6-beta.1', 'beta', null).reason, 'unapproved-downgrade');
  assert.equal(policy.evaluateOfferedVersion('0.9.6-beta.1', '0.9.6', 'beta', null).reason, 'channel-mismatch');
  assert.equal(policy.evaluateOfferedVersion('0.9.6-beta.1', '0.9.6-beta.1', 'beta', null).reason, 'version-not-actionable');

  const approvedRollback = policy.parseRollbackControl(rollback(), 'beta');
  assert.deepEqual(
    policy.evaluateOfferedVersion('0.9.6-beta.2', '0.9.6-beta.1', 'beta', approvedRollback),
    { approved: true, allowDowngrade: true, reason: 'approved-rollback' },
  );
  assert.equal(
    policy.evaluateOfferedVersion('0.9.6-beta.3', '0.9.6-beta.2', 'beta', approvedRollback).reason,
    'rollback-target-mismatch',
  );
  assert.equal(
    policy.evaluateOfferedVersion('0.9.6-beta.1', '0.9.6-beta.2', 'beta', rollback({ targetVersion: '0.9.6-beta.2' })).reason,
    'rollback-target-not-older',
  );
}

function verifyRuntimeWiring() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'core', 'update', 'DesktopUpdater.ts'), 'utf8');
  for (const required of [
    "redirect: 'manual'",
    'MAXIMUM_REMOTE_JSON_BYTES',
    "cache: 'no-store'",
    'new TextDecoder',
    'decision.allowDowngrade !== updater.allowDowngrade',
    'parseChannelControl',
    'parsePublishedCandidate',
    'parseRollbackControl',
  ]) assert(source.includes(required), `Desktop updater is missing policy wiring: ${required}`);
}

verifyVersions();
verifyConfiguration();
verifyControls();
verifyDecisions();
verifyRuntimeWiring();
console.log('ATHENA_UPDATE_POLICY_OK matrix=passed schema=strict remote=same-origin-bounded rollback=candidate-bound');
