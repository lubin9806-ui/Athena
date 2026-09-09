// The schema 20 rebuild only runs on a database that predates it, so a fresh
// database proves nothing: it is created with the widened CHECK already in
// place. This walks a real 19 -> 20 upgrade, rows and all.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-attachment-migration-'));
process.env.ATHENA_DB_DIR = path.join(tempDir, 'database');
process.env.ATHENA_DB_FILENAME = 'migration-test.db';
process.env.ATHENA_ATTACHMENT_DIR = path.join(tempDir, 'managed-attachments');
process.env.ATHENA_CONFIG_DIR = path.join(tempDir, 'config');

const root = path.resolve(__dirname, '..');
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));
const memory = require(path.join(root, 'dist', 'memory', 'index.js'));

const SPREADSHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_ATTACHMENT_TABLE = `
  CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    window_id INTEGER NOT NULL REFERENCES chat_windows(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('image', 'document', 'audio')),
    mime_type TEXT NOT NULL CHECK(mime_type IN (
      'image/png', 'image/jpeg', 'image/webp',
      'text/plain', 'text/markdown', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'audio/wav', 'audio/aiff', 'audio/flac'
    )),
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 26214400),
    width INTEGER CHECK(width IS NULL OR (width > 0 AND width <= 16384)),
    height INTEGER CHECK(height IS NULL OR (height > 0 AND height <= 16384)),
    content_text TEXT,
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'attached')),
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    CHECK((status = 'pending' AND message_id IS NULL) OR (status = 'attached' AND message_id IS NOT NULL))
  );
`;

const SHA = 'a'.repeat(64);
const LEGACY_ROW = {
  id: '11111111-2222-4333-8444-555555555555',
  kind: 'document',
  mime_type: 'text/markdown',
  original_name: '旧附件.md',
  storage_path: path.join(tempDir, 'managed-attachments', 'legacy.md'),
  bytes: 42,
  content_text: '这是升级前就存在的附件正文。',
  sha256: SHA,
};

let exitCode = 0;
try {
  // 1. A current database, with a window and a message the legacy row can hang off.
  const project = memory.ensureDefaultProject();
  const chatWindow = memory.createChatWindow({ title: 'Migration', projectId: project.id });
  const message = memory.saveChatMessage(chatWindow.id, 'user', '带附件的一条旧消息', undefined, 'companion');
  const dbPath = memory.getDatabaseFilePath();
  memory.closeDatabase();

  // 2. Rewind that database to what schema 19 looked like, carrying one row.
  const legacy = new Database(dbPath);
  legacy.pragma('foreign_keys = OFF');
  legacy.exec('DROP TABLE chat_attachments;');
  legacy.exec(LEGACY_ATTACHMENT_TABLE);
  legacy.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_window_status ON chat_attachments(window_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_project ON chat_attachments(project_id, created_at);
  `);
  legacy.prepare(`
    INSERT INTO chat_attachments (
      id, window_id, message_id, project_id, kind, mime_type, original_name,
      storage_path, bytes, content_text, sha256, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'attached', '2026-01-02 03:04:05')
  `).run(
    LEGACY_ROW.id, chatWindow.id, message.id, project.id, LEGACY_ROW.kind, LEGACY_ROW.mime_type,
    LEGACY_ROW.original_name, LEGACY_ROW.storage_path, LEGACY_ROW.bytes, LEGACY_ROW.content_text, LEGACY_ROW.sha256,
  );
  // The old CHECK really did refuse a spreadsheet, which is why this migration exists.
  assert.throws(
    () => legacy.prepare(`
      INSERT INTO chat_attachments (id, window_id, message_id, project_id, kind, mime_type, original_name, storage_path, bytes, sha256, status)
      VALUES ('99999999-2222-4333-8444-555555555555', ?, NULL, ?, 'document', ?, 'x.xlsx', ?, 10, ?, 'pending')
    `).run(chatWindow.id, project.id, SPREADSHEET_MIME, path.join(tempDir, 'x.xlsx'), SHA),
    /CHECK constraint failed/,
    'the pre-migration table must reject a spreadsheet, or this test proves nothing',
  );
  legacy.pragma('user_version = 19');
  legacy.close();

  // 3. Reopening runs the upgrade.
  const upgraded = memory.getDatabase();
  assert.equal(upgraded.pragma('user_version', { simple: true }), 20, 'the database must land on schema 20');

  const carried = upgraded.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(LEGACY_ROW.id);
  assert.ok(carried, 'the pre-existing attachment row must survive the table rebuild');
  assert.equal(carried.original_name, LEGACY_ROW.original_name);
  assert.equal(carried.content_text, LEGACY_ROW.content_text);
  assert.equal(carried.sha256, LEGACY_ROW.sha256);
  assert.equal(carried.bytes, LEGACY_ROW.bytes);
  assert.equal(carried.status, 'attached');
  assert.equal(carried.message_id, message.id);
  assert.equal(carried.created_at, '2026-01-02 03:04:05', 'timestamps must not be reset by the rebuild');

  const indexes = upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_attachments'")
    .all().map(row => row.name);
  for (const expected of ['idx_chat_attachments_window_status', 'idx_chat_attachments_message', 'idx_chat_attachments_project']) {
    assert.ok(indexes.includes(expected), `the rebuild dropped ${expected}`);
  }
  assert.equal(
    upgraded.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'chat_attachments_schema20'").get().c,
    0,
    'the scratch table used during the rebuild must not survive it',
  );

  upgraded.prepare(`
    INSERT INTO chat_attachments (id, window_id, message_id, project_id, kind, mime_type, original_name, storage_path, bytes, sha256, status)
    VALUES ('77777777-2222-4333-8444-555555555555', ?, NULL, ?, 'document', ?, 'quarter.xlsx', ?, 128, ?, 'pending')
  `).run(chatWindow.id, project.id, SPREADSHEET_MIME, path.join(tempDir, 'quarter.xlsx'), SHA);
  assert.equal(
    upgraded.prepare('SELECT mime_type FROM chat_attachments WHERE id = ?').get('77777777-2222-4333-8444-555555555555').mime_type,
    SPREADSHEET_MIME,
  );
  assert.throws(
    () => upgraded.prepare(`
      INSERT INTO chat_attachments (id, window_id, message_id, project_id, kind, mime_type, original_name, storage_path, bytes, sha256, status)
      VALUES ('88888888-2222-4333-8444-555555555555', ?, NULL, ?, 'document', 'application/x-msdownload', 'x.exe', ?, 10, ?, 'pending')
    `).run(chatWindow.id, project.id, path.join(tempDir, 'x.exe'), SHA),
    /CHECK constraint failed/,
    'the widened CHECK must still be a CHECK',
  );

  assert.deepEqual(upgraded.pragma('foreign_key_check'), [], 'the rebuilt table must keep its foreign keys');
  const cascadeWindow = memory.createChatWindow({ title: 'Cascade', projectId: project.id });
  memory.deleteChatWindow(cascadeWindow.id);
  assert.deepEqual(upgraded.pragma('foreign_key_check'), []);

  const backups = fs.existsSync(path.join(tempDir, 'database', 'backups'))
    ? fs.readdirSync(path.join(tempDir, 'database', 'backups'))
    : [];
  assert.ok(
    backups.some(name => name.includes('.before-migration-')),
    'a migration must leave the pre-upgrade database behind to fall back to',
  );

  console.log('ATHENA_CHAT_ATTACHMENT_MIGRATION_OK from=19 to=20 rowsCarried=1 indexes=3 backup=yes');
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
  // better-sqlite3 is built against Electron's ABI, so this runs under Electron,
  // whose main process keeps its loop alive unless told to stop.
  process.exit(exitCode);
}
