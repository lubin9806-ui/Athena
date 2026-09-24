'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..');
  const mapperPath = path.join(root, 'dist', 'core', 'cloud', 'CloudSyncMapper.js');
  const protocolPath = path.join(root, 'dist', 'core', 'cloud', 'CloudProtocol.js');
  if (!fs.existsSync(mapperPath) || !fs.existsSync(protocolPath)) {
    throw new Error('dist/core/cloud is missing. Run tsc first.');
  }
  const mapper = require(mapperPath);
  const { CloudProtocol, CloudProtocolError } = require(protocolPath);
  const { buildMobilePairingUri, mobilePairingBaseUrl } = require(path.join(root, 'dist', 'core', 'cloud', 'CloudAccountService.js'));

  assert.equal(mapper.shouldSyncWindow({ mode: 'companion', is_temporary: false }), true);
  assert.equal(mapper.shouldSyncWindow({ mode: 'execute', is_temporary: false }), false);
  assert.equal(mapper.shouldSyncWindow({ mode: 'companion', is_temporary: true }), false);
  assert.equal(mapper.conversationResourceId(12), 'conversation.desktop-12');

  const payload = mapper.toConversationPayload(
    { title: 'Night chat', mode: 'companion' },
    [{ role: 'user', content: 'hello', created_at: '2026-09-02T00:00:00.000Z' }],
  );
  assert.equal(payload.origin, 'desktop');
  assert.equal(payload.turns.length, 1);

  // ATH-CLOUD-004: the window label is not a classification of its contents. A
  // window sitting in Companion mode can still hold the Execute turns from earlier,
  // and those carry computer operations and their results.
  const mixed = mapper.toConversationPayload(
    { title: 'Mixed window', mode: 'companion' },
    [
      { role: 'user', content: 'chat turn', mode: 'companion', created_at: '2026-09-02T00:00:00.000Z' },
      { role: 'user', content: 'delete everything under D:\\work', mode: 'execute', created_at: '2026-09-02T00:01:00.000Z' },
      { role: 'assistant', content: 'removed 42 files', mode: 'execute', created_at: '2026-09-02T00:02:00.000Z' },
      { role: 'assistant', content: 'chat reply', mode: 'create', created_at: '2026-09-02T00:03:00.000Z' },
      { role: 'system', content: 'internal note', mode: 'companion', created_at: '2026-09-02T00:04:00.000Z' },
    ],
  );
  assert.deepEqual(mixed.turns.map(turn => turn.content), ['chat turn', 'chat reply']);
  const serialized = JSON.stringify(mixed);
  assert(!serialized.includes('delete everything'), 'execute turns must not leave the device');
  assert(!serialized.includes('removed 42 files'), 'execute results must not leave the device');
  assert(!serialized.includes('internal note'), 'system turns are not synced');

  assert.equal(mapper.shouldSyncMessage({ role: 'user', mode: 'execute' }), false);
  assert.equal(mapper.shouldSyncMessage({ role: 'assistant', mode: 'execute' }), false);
  assert.equal(mapper.shouldSyncMessage({ role: 'user', mode: 'companion' }), true);
  assert.equal(mapper.shouldSyncMessage({ role: 'system', mode: 'companion' }), false);

  // A window whose syncable turns were all filtered out has nothing to send.
  const executeOnly = mapper.toConversationPayload(
    { title: 'Was execute', mode: 'reason' },
    [{ role: 'user', content: 'run the build', mode: 'execute', created_at: '2026-09-02T00:00:00.000Z' }],
  );
  assert.equal(executeOnly.turns.length, 0);

  // A conversation is one thing both clients edit. The desktop must recognise
  // the records it writes for its own windows, or it would adopt them back and
  // clone every window on every sync.
  assert.equal(mapper.desktopWindowIdFromResourceId('conversation.desktop-12'), 12);
  assert.equal(mapper.desktopWindowIdFromResourceId('conversation.android-abc'), null);
  // The namespace has to be pinned, not just the shape: another client's record
  // that happens to end in digits must never be mistaken for a local window.
  assert.equal(mapper.desktopWindowIdFromResourceId('conversation.android-12'), null);
  assert.equal(mapper.desktopWindowIdFromResourceId('conversation.desktop-'), null);
  assert.equal(mapper.desktopWindowIdFromResourceId('conversation.desktop-0'), null);
  assert.equal(mapper.desktopWindowIdFromResourceId('memory.desktop-3'), null);

  // Merging a record back into a window it already owns must add only what is
  // missing; re-adding what is there would double the history on every sync.
  const existing = [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
  ];
  const incoming = [
    { role: 'user', content: 'first question', mode: 'companion', createdAt: '2026-09-09T00:00:00.000Z' },
    { role: 'assistant', content: 'first answer', mode: 'companion', createdAt: '2026-09-09T00:00:01.000Z' },
    { role: 'user', content: 'asked from the phone', mode: 'companion', createdAt: '2026-09-09T00:01:00.000Z' },
  ];
  const appended = mapper.turnsToAppend(existing, incoming);
  assert.deepEqual(appended.map((turn) => turn.content), ['asked from the phone']);
  assert.equal(mapper.turnsToAppend(existing, incoming).length, 1, 'merge must be repeatable');
  assert.deepEqual(mapper.turnsToAppend(existing, []), []);
  assert.deepEqual(mapper.turnsToAppend(existing, 5), [], 'a turn count is not a turn list');

  // An execute turn arriving from another client is refused rather than stored,
  // and so are system turns and empty content.
  const hostile = mapper.turnsToAppend([], [
    { role: 'assistant', content: 'removed 42 files', mode: 'execute' },
    { role: 'system', content: 'internal note', mode: 'companion' },
    { role: 'user', content: '', mode: 'companion' },
    { role: 'user', content: 'kept', mode: 'companion' },
  ]);
  assert.deepEqual(hostile.map((turn) => turn.content), ['kept']);

  // The same sentence twice inside one record is written once; this is the
  // known cost of matching on text, since created_at is restamped locally.
  assert.equal(mapper.turnsToAppend([], [
    { role: 'user', content: 'same', mode: 'companion' },
    { role: 'user', content: 'same', mode: 'companion' },
  ]).length, 1);

  // A reminder adopted from another client keeps that client's id, so it writes
  // back to the same record. Giving it a desktop id would put two records in the
  // account for one reminder, and the phone would show it twice.
  assert.equal(mapper.reminderResourceId('job-17-abc'), 'reminder.desktop-job-17-abc');
  assert.equal(mapper.reminderResourceId('reminder.android-xyz'), 'reminder.android-xyz');
  assert.equal(mapper.desktopReminderJobIdFromResourceId('reminder.desktop-job-17-abc'), 'job-17-abc');
  assert.equal(mapper.desktopReminderJobIdFromResourceId('reminder.android-xyz'), null);
  assert.equal(mapper.ownsReminderResource('reminder.desktop-job-1'), true);
  assert.equal(mapper.ownsReminderResource('reminder.android-xyz'), false);
  assert.deepEqual(mapper.desktopMemoryRefFromResourceId('memory.desktop-event-42'), { kind: 'event', id: 42 });
  assert.equal(mapper.desktopMemoryRefFromResourceId('memory.android-42'), null);

  const reminderOut = mapper.toReminderPayload({ title: '回电话', dueAt: '2026-09-10T12:00:00.000Z', status: 'scheduled' });
  assert.equal(reminderOut.origin, 'desktop');
  assert.equal(reminderOut.status, 'scheduled');
  assert.equal(mapper.toReminderPayload({ title: 'x'.repeat(400), dueAt: '2026-09-10T12:00:00.000Z', status: 'completed' }).title.length, 200);

  // A reminder with no time cannot fire, and one with no words says nothing
  // when it does. Both are refused rather than guessed at: the failure worth
  // avoiding here is interrupting someone about nothing.
  assert.equal(mapper.parseReminderPayload({ title: '喝水', dueAt: 'tomorrow' }), null);
  assert.equal(mapper.parseReminderPayload({ title: '喝水', dueAt: '' }), null);
  assert.equal(mapper.parseReminderPayload({ title: '   ', dueAt: '2026-09-10T12:00:00.000Z' }), null);
  const reminderIn = mapper.parseReminderPayload({ origin: 'android', title: '喝水', dueAt: '2026-09-10T12:00:00.000Z', status: 'completed' });
  assert.equal(reminderIn.origin, 'android');
  assert.equal(reminderIn.status, 'completed');
  // A status a later client invented is read as still scheduled: refusing to
  // ring would lose the reminder, which is the worse of the two mistakes.
  assert.equal(mapper.parseReminderPayload({ title: '喝水', dueAt: '2026-09-10T12:00:00.000Z', status: 'snoozed' }).status, 'scheduled');
  // Round trip, because both ends have to read what the other wrote.
  assert.deepEqual(
    mapper.parseReminderPayload(mapper.toReminderPayload({ title: '回电话', dueAt: '2026-09-10T12:00:00.000Z', status: 'cancelled' })),
    { origin: 'desktop', title: '回电话', dueAt: '2026-09-10T12:00:00.000Z', status: 'cancelled' },
  );

  // The server refuses to pick a side on a conflict and the client may not
  // either. Retrying the write against the server's vector looks like a retry
  // and is a silent overwrite: the other device's turns disappear unannounced.
  const service = fs.readFileSync(path.join(root, 'src', 'core', 'cloud', 'CloudAccountService.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'app', 'preload.ts'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
  const rendererHtml = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const pushBody = service.slice(service.indexOf('async function pushLocalState'), service.indexOf('function ownsResource'));
  assert.match(pushBody, /conflicted\.push\(/, 'a conflicting conversation must be reported');
  assert.match(pushBody, /sync-conflict/, 'a sync that left a conflict must not report success');
  assert.match(pushBody, /baseVector: vectors\[resourceId\] \|\| \{\}/, 'a repeated write must use the last server vector');
  assert.match(pushBody, /rememberAcceptedVector\(vectors, resourceId/, 'accepted writes must advance the stored vector');
  assert.match(pushBody, /resourceId\.startsWith\('conversation\.'\)/, 'memory ids must not be mistaken for adopted conversations');
  const conversationConflictBody = pushBody.slice(
    pushBody.indexOf("if (first.outcome === 'conflict')"),
    pushBody.indexOf('// Reminders finished here'),
  );
  assert.doesNotMatch(
    conversationConflictBody,
    /await client\.putRecord/,
    'the desktop is writing again after a conflict, which discards the other client turns',
  );

  // The mapper being right is not the same as the sync using it. Reminders were
  // an allowed resource type that neither client ever read or wrote, which is
  // exactly how a feature ends up green and absent.
  assert.match(pushBody, /listSyncableReminders\(\)/, 'the desktop must push its own reminders');
  assert.match(pushBody, /resourceType: 'reminder'/, 'reminders must be pushed under their own resource type');
  const applyBody = service.slice(service.indexOf('const pulled = await pullAllChanges'), service.indexOf('const updatedSession'));
  assert.match(applyBody, /adoptSyncedReminder\(/, 'a reminder written on another device must be applied here');
  assert.match(applyBody, /desktopReminderJobIdFromResourceId\(resourceId\)/, 'a desktop reminder edited on the phone must update its original job');
  assert.match(applyBody, /desktopWindowIdFromResourceId\(resourceId\)/, 'phone turns added to a desktop conversation must return to that window');
  assert.match(applyBody, /applyCloudTombstone\(/, 'deletions from another device must be applied locally');
  assert.match(service, /listMemories\(\{ kind: 'all', limit: 200 \}\)/, 'desktop memory kinds are still only partially synced');
  assert.match(service, /adoptedMemories\.get/, 'an imported phone memory would be pushed back under a duplicate id');
  assert.match(service, /async function pullAllChanges/, 'the desktop would silently stop after the first change page');
  assert.match(service, /const account = await client\.account\(\)/, 'desktop account status must come from the server');
  assert.match(service, /const deviceBody = await client\.listDevices\(\)/, 'desktop account status must show server devices');
  assert.match(ipc, /mfaCode: cleanString\(payload\.mfaCode/, 'desktop IPC must pass an MFA code to login');
  assert.match(ipc, /recoveryCode: cleanString\(payload\.recoveryCode/, 'desktop IPC must pass a recovery code to login');
  assert.match(preload, /createCloudPairingOffer/, 'desktop preload must expose pairing without exposing raw IPC');
  assert.match(renderer, /createCloudPairingOffer\(\)/, 'desktop account UI must be able to create a phone pairing code');
  assert.match(renderer, /offer\.pairingUri/, 'desktop must hand the phone client both the short-lived code and Cloud endpoint');
  assert.match(service, /offerPairing\([^\n]+, false\)/, 'desktop pairing must not reuse the account session');
  assert.match(service, /settings\.pairingBaseUrl/, 'desktop pairing must use a transport separate from the account endpoint');
  assert.match(service, /if \(categories\.conversations\)/, 'conversation sync needs its own category gate');
  assert.match(service, /if \(categories\.memories\)/, 'memory sync needs its own category gate');
  assert.match(service, /if \(categories\.reminders\)/, 'reminder sync needs its own category gate');
  assert.match(service, /session\.syncCategoriesKey === categoriesKey \? session\.cursor : null/, 'enabling a category must replay records skipped by the old cursor');
  for (const id of [
    'setting-cloud-sync-conversations',
    'setting-cloud-sync-memories',
    'setting-cloud-sync-persona',
    'setting-cloud-sync-preferences',
    'setting-cloud-sync-reminders',
    'setting-cloud-sync-background',
    'setting-cloud-sync-adult-mode',
  ]) {
    assert.match(rendererHtml, new RegExp(`id="${id}"`), `desktop sync selector is missing ${id}`);
  }
  assert.match(rendererHtml, /id="setting-cloud-sync-background"[^>]*disabled/, 'background sync must stay visibly unavailable until sanitized adaptation is implemented');
  assert.match(rendererHtml, /id="setting-cloud-sync-adult-mode"[^>]*disabled/, 'adult-mode sync must stay visibly unavailable until its preference record is implemented');
  assert.match(rendererHtml, /id="setting-cloud-mfa-code"/, 'desktop account UI must accept an MFA code');
  assert.match(rendererHtml, /id="setting-cloud-recovery-code"/, 'desktop account UI must accept a recovery code');
  assert.doesNotMatch(rendererHtml, /id="setting-cloud-tenant-id"/, 'tenant ID must not be part of the user login flow');
  assert.ok(
    service.indexOf('const pulled = await pullAllChanges') < service.indexOf('await pushLocalState(client, imported, importedMemoryKinds, vectors)'),
    'the desktop must pull current vectors and remote turns before it writes',
  );

  assert.throws(() => CloudProtocol.assertBaseUrl(''), /基址为空/);
  assert.throws(() => CloudProtocol.assertBaseUrl('http://example.test', true), /HTTPS/);
  assert.equal(CloudProtocol.assertBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  const pairingUri = buildMobilePairingUri('https://cloud.example.test/', '123456');
  assert.equal(pairingUri, 'athena://pair?version=1&server=https%3A%2F%2Fcloud.example.test&code=123456');
  const lanBaseUrl = mobilePairingBaseUrl('http://127.0.0.1:8787', '192.168.1.20');
  assert.equal(lanBaseUrl, 'http://192.168.1.20:8787');
  assert.equal(
    buildMobilePairingUri(lanBaseUrl, '654321'),
    'athena://pair?version=1&server=http%3A%2F%2F192.168.1.20%3A8787&code=654321',
  );
  assert.throws(() => buildMobilePairingUri('http://example.test', '123456'), /私有局域网/);
  assert.throws(() => buildMobilePairingUri('https://cloud.example.test', 'not-a-code'), /配对码/);

  const { loadConfig } = require(path.join(root, 'cloud', 'src', 'config'));
  const { createCloudApp } = require(path.join(root, 'cloud', 'src', 'server'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-desktop-cloud-'));
  const app = createCloudApp(loadConfig({
    port: 0,
    dbPath: path.join(temp, 'cloud.db'),
    backupDir: path.join(temp, 'backups'),
    exportDir: path.join(temp, 'exports'),
    masterKey: crypto.randomBytes(32),
  }));
  try {
    const address = await app.listen();
    const client = new CloudProtocol(`http://127.0.0.1:${address.port}`, 'desktop');
    const account = await client.register({
      tenantName: 'Desktop Sync',
      email: 'desktop-sync@example.test',
      password: 'correct horse battery staple desktop',
      deviceName: 'Athena Desktop',
    });
    assert.ok(account.accessToken);
    const accountStatus = await client.account();
    assert.equal(accountStatus.email, 'desktop-sync@example.test');
    assert.equal(accountStatus.mfaEnabled, false);
    const emailOnlyClient = new CloudProtocol(`http://127.0.0.1:${address.port}`, 'desktop');
    const emailOnlySession = await emailOnlyClient.login({
      email: 'desktop-sync@example.test',
      password: 'correct horse battery staple desktop',
      deviceName: 'Athena Desktop email-only login',
    });
    assert.equal(emailOnlySession.tenantId, account.tenantId);
    const deviceList = await client.listDevices();
    assert.ok(deviceList.devices.some((device) => device.id === client.session.deviceId && device.status === 'active'));
    const pairing = await client.offerPairing('Athena Desktop');
    assert.match(pairing.code, /^\d{6}$/);
    assert.ok(Number(pairing.expiresInSeconds) > 0);
    const anonymousPairingClient = new CloudProtocol(`http://127.0.0.1:${address.port}`, 'desktop');
    const anonymousPairing = await anonymousPairingClient.offerPairing('Athena Desktop local connection', false);
    assert.match(anonymousPairing.code, /^\d{6}$/);
    const pushed = await client.putRecord({
      resourceId: 'conversation.desktop-1',
      resourceType: 'conversation',
      schemaVersion: 1,
      baseVector: {},
      payload,
      deleted: false,
    });
    assert.equal(pushed.outcome, 'accepted');
    const changes = await client.listChanges();
    assert.ok(changes.records.some((item) => item.resourceId === 'conversation.desktop-1'));
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('ATHENA_DESKTOP_CLOUD_SYNC_OK execute=excluded temporary=excluded protocol=v1 production=no-go');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
