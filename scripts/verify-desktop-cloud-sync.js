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

  // The server refuses to pick a side on a conflict and the client may not
  // either. Retrying the write against the server's vector looks like a retry
  // and is a silent overwrite: the other device's turns disappear unannounced.
  const service = fs.readFileSync(path.join(root, 'src', 'core', 'cloud', 'CloudAccountService.ts'), 'utf8');
  const pushBody = service.slice(service.indexOf('async function pushLocalState'), service.indexOf('function ownsResource'));
  assert.match(pushBody, /conflicted\.push\(/, 'a conflicting conversation must be reported');
  assert.match(pushBody, /conversation-conflict/, 'a sync that left a conflict must not report success');
  assert.doesNotMatch(
    pushBody,
    /outcome === 'conflict'[\s\S]{0,400}?await client\.putRecord/,
    'the desktop is writing again after a conflict, which discards the other client turns',
  );

  assert.throws(() => CloudProtocol.assertBaseUrl(''), /基址为空/);
  assert.throws(() => CloudProtocol.assertBaseUrl('http://example.test', true), /HTTPS/);
  assert.equal(CloudProtocol.assertBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');

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
