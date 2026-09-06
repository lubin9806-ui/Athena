import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveProjectRoot } from '../../core/runtime/Paths';
import { ensureSufficientDiskSpace } from '../../core/runtime/DiskSpaceGuard';

let db: Database.Database | null = null;
let resolvedDbPath: string | null = null;
export const DATABASE_SCHEMA_VERSION = 18;
const MIGRATION_BACKUP_RETENTION = 5;

export interface MemoryStats {
  messageCount: number;
  profileCount: number;
  eventCount: number;
  dailySummaryCount: number;
  proceduralMemoryCount: number;
  temporalFactCount: number;
  reviewQueuePendingCount: number;
  projectNoteCount: number;
  attachmentCount: number;
  indexCount: number;
  dbSize: string;
}

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDatabasePath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  ensureSufficientDiskSpace(dbDir, 16 * 1024 * 1024);
  seedPackagedDatabase(dbPath);

  let backupPath: string | null = null;
  let opened: Database.Database | null = null;
  try {
    opened = new Database(dbPath);
    opened.pragma(`busy_timeout = ${Math.max(50, Math.min(30_000, Number(process.env.ATHENA_DB_BUSY_TIMEOUT_MS) || 5_000))}`);
    opened.pragma('journal_mode = WAL');
    opened.pragma('foreign_keys = ON');
    const currentVersion = Number(opened.pragma('user_version', { simple: true })) || 0;
    if (currentVersion < DATABASE_SCHEMA_VERSION) {
      backupPath = createConsistentMigrationBackup(opened, dbPath);
      runMigrations(opened, currentVersion);
    } else if (currentVersion > DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema ${currentVersion} is newer than this application supports (${DATABASE_SCHEMA_VERSION}).`);
    }
    db = opened;
  } catch (error) {
    try {
      opened?.close();
    } catch {
      // A failed migration may leave SQLite half-open; restoration is still best effort.
    }
    if (backupPath) restoreDatabaseBackup(dbPath, backupPath);
    throw error;
  }
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  const closing = db;
  try {
    closing.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Closing the SQLite handle is still required when another reader prevents truncation.
  } finally {
    try {
      closing.close();
    } finally {
      db = null;
    }
  }
}

export function getStats(): MemoryStats {
  const database = getDatabase();
  const messageCount = countRows(database, 'messages');
  const profileCount = countRows(database, 'profile');
  const eventCount = countRows(database, 'events');
  const dailySummaryCount = countRows(database, 'daily_memory_summaries');
  const proceduralMemoryCount = countRows(database, 'procedural_memories');
  const temporalFactCount = countRows(database, 'memory_facts');
  const reviewQueuePendingCount = countWhere(database, 'memory_review_queue', "status = 'pending'");
  const projectNoteCount = countRows(database, 'project_notes');
  const attachmentCount = countRows(database, 'chat_attachments');
  const indexCount = countRows(database, 'memory_index');

  let dbSize = '0 MB';
  try {
    const stats = fs.statSync(getDatabasePath());
    dbSize = `${(stats.size / (1024 * 1024)).toFixed(2)} MB`;
  } catch {
    // The file may not exist yet on very first startup.
  }

  return { messageCount, profileCount, eventCount, dailySummaryCount, proceduralMemoryCount, temporalFactCount, reviewQueuePendingCount, projectNoteCount, attachmentCount, indexCount, dbSize };
}

export function getDatabaseFilePath(): string {
  return getDatabasePath();
}

export function getDatabaseBackupDir(): string {
  return path.join(resolveDatabaseDir(), 'backups');
}

export function backupDatabaseBeforeMigration(dbPath: string = getDatabasePath(), now: Date = new Date()): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const backupDir = getDatabaseBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(dbPath)}.before-migration-${stamp}.bak`);
  fs.copyFileSync(dbPath, backupPath);
  copySidecarIfPresent(`${dbPath}-wal`, `${backupPath}-wal`);
  copySidecarIfPresent(`${dbPath}-shm`, `${backupPath}-shm`);
  return backupPath;
}

export function restoreDatabaseBackup(dbPath: string, backupPath: string): void {
  if (!fs.existsSync(backupPath)) return;
  removeIfPresent(`${dbPath}-wal`);
  removeIfPresent(`${dbPath}-shm`);
  fs.copyFileSync(backupPath, dbPath);
  restoreSidecarIfPresent(`${backupPath}-wal`, `${dbPath}-wal`);
  restoreSidecarIfPresent(`${backupPath}-shm`, `${dbPath}-shm`);
}

function createConsistentMigrationBackup(database: Database.Database, dbPath: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return null;
  const backupDir = getDatabaseBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(dbPath)}.before-migration-${stamp}.bak`);
  database.pragma('wal_checkpoint(FULL)');
  database.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  pruneMigrationBackups(backupDir);
  return backupPath;
}

function pruneMigrationBackups(backupDir: string): void {
  const backups = fs.readdirSync(backupDir)
    .filter(name => name.includes('.before-migration-') && name.endsWith('.bak'))
    .map(name => ({ name, path: path.join(backupDir, name), modified: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  for (const backup of backups.slice(MIGRATION_BACKUP_RETENTION)) removeIfPresent(backup.path);
}

function runMigrations(database: Database.Database, currentVersion: number): void {
  if (currentVersion < 0) throw new Error(`Invalid database schema version: ${currentVersion}`);
  const migrate = database.transaction(() => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      memory_state TEXT NOT NULL DEFAULT '{}',
      archived_at DATETIME,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_active_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_projects_last_active ON projects(deleted_at, archived_at, last_active_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      emotion TEXT,
      mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute')),
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

    CREATE TABLE IF NOT EXISTS chat_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'companion' CHECK(mode IN ('create', 'companion', 'reason', 'execute')),
      working_state TEXT NOT NULL DEFAULT '{}',
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      project_instructions_snapshot TEXT NOT NULL DEFAULT '',
      is_temporary INTEGER NOT NULL DEFAULT 0 CHECK(is_temporary IN (0, 1)),
      archived_at DATETIME,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_active_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_windows_last_active ON chat_windows(deleted_at, archived_at, last_active_at DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id INTEGER NOT NULL REFERENCES chat_windows(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      emotion TEXT,
      mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute')),
      ephemeral INTEGER NOT NULL DEFAULT 0 CHECK(ephemeral IN (0, 1)),
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_window_id ON chat_messages(window_id, id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_window_created_at ON chat_messages(window_id, created_at);

    CREATE TABLE IF NOT EXISTS chat_attachments (
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
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_window_status ON chat_attachments(window_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_project ON chat_attachments(project_id, created_at);

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('identity', 'preference', 'habit', 'project', 'health')),
      fact TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT,
      importance INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_recalled_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_profile_category ON profile(category);
    CREATE INDEX IF NOT EXISTS idx_profile_fact ON profile(fact);
    CREATE INDEX IF NOT EXISTS idx_profile_importance ON profile(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_profile_updated_at ON profile(updated_at DESC);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      tags TEXT DEFAULT '[]',
      emotion TEXT,
      importance INTEGER DEFAULT 5,
      recalled_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
    CREATE INDEX IF NOT EXISTS idx_events_importance ON events(importance DESC);

    CREATE TABLE IF NOT EXISTS daily_memory_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      highlights TEXT NOT NULL DEFAULT '[]',
      source_event_count INTEGER NOT NULL DEFAULT 0,
      source_message_count INTEGER NOT NULL DEFAULT 0,
      max_importance INTEGER NOT NULL DEFAULT 1,
      importance INTEGER NOT NULL DEFAULT 5,
      decay_stage TEXT NOT NULL DEFAULT 'fresh' CHECK(decay_stage IN ('fresh', 'year_one', 'decay_5', 'decay_6', 'decay_7', 'decay_8', 'expired')),
      summary_method TEXT NOT NULL DEFAULT 'heuristic' CHECK(summary_method IN ('heuristic', 'llm-refined')),
      generated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_daily_memory_summaries_date ON daily_memory_summaries(date DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_memory_summaries_importance ON daily_memory_summaries(importance DESC, date DESC);

    CREATE TABLE IF NOT EXISTS procedural_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'project', 'mode', 'tool', 'persona')),
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      key TEXT NOT NULL,
      instruction TEXT NOT NULL,
      evidence TEXT,
      confidence REAL DEFAULT 0.7,
      importance INTEGER DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_recalled_at DATETIME,
      CHECK(scope = 'project' OR project_id IS NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_procedural_memories_scope ON procedural_memories(scope, status, importance DESC);
    CREATE INDEX IF NOT EXISTS idx_procedural_memories_updated ON procedural_memories(updated_at DESC);

    CREATE TABLE IF NOT EXISTS memory_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'concept',
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(type, name)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name);

    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_entity_id INTEGER REFERENCES memory_entities(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      importance INTEGER DEFAULT 6,
      valid_from DATETIME DEFAULT (datetime('now', 'localtime')),
      valid_to DATETIME,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'archived')),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject, predicate, status);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_valid ON memory_facts(status, valid_from DESC, valid_to);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_importance ON memory_facts(importance DESC);

    CREATE TABLE IF NOT EXISTS memory_fact_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
      source_table TEXT NOT NULL,
      source_id INTEGER,
      quote TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_fact_sources_fact ON memory_fact_sources(fact_id);

    CREATE TABLE IF NOT EXISTS memory_review_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('profile', 'event', 'project', 'procedure', 'fact')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      group_key TEXT,
      confidence REAL DEFAULT 0.5,
      importance INTEGER DEFAULT 5,
      source_table TEXT,
      source_id INTEGER,
      chat_window_id INTEGER REFERENCES chat_windows(id) ON DELETE SET NULL,
      applied_table TEXT,
      applied_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      reviewed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_memory_review_queue_status ON memory_review_queue(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_review_queue_kind ON memory_review_queue(kind, status, importance DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_review_queue_applied ON memory_review_queue(applied_table, applied_id, status);

    CREATE TABLE IF NOT EXISTS project_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'done', 'archived')),
      tags TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_recalled_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project);
    CREATE INDEX IF NOT EXISTS idx_project_notes_title ON project_notes(title);
    CREATE INDEX IF NOT EXISTS idx_project_notes_status ON project_notes(status);
    CREATE INDEX IF NOT EXISTS idx_project_notes_importance ON project_notes(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_project_notes_updated_at ON project_notes(updated_at DESC);

    CREATE TABLE IF NOT EXISTS project_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK(mime_type IN ('text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
      storage_path TEXT NOT NULL UNIQUE,
      bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 26214400),
      sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
      parser TEXT NOT NULL CHECK(parser IN ('plain-text', 'pdfjs', 'mammoth')),
      ocr_engine TEXT CHECK(ocr_engine IS NULL OR ocr_engine = 'tesseract.js'),
      ocr_languages TEXT NOT NULL DEFAULT '[]',
      needs_ocr INTEGER NOT NULL DEFAULT 0 CHECK(needs_ocr IN (0, 1)),
      page_count INTEGER,
      char_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'error')),
      error TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(project_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS project_document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
      locator TEXT NOT NULL,
      page_start INTEGER,
      page_end INTEGER,
      text TEXT NOT NULL,
      char_count INTEGER NOT NULL CHECK(char_count > 0),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(document_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_project_document_chunks_project ON project_document_chunks(project_id, document_id, ordinal);

    CREATE TABLE IF NOT EXISTS memory_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      project_id INTEGER,
      keywords TEXT NOT NULL,
      semantic_vector TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(source_table, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_index_source ON memory_index(source_table, source_id);

    CREATE TABLE IF NOT EXISTS data_activity_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_data_activity_category_created ON data_activity_records(category, created_at);

    -- schema 17: scheduled work outlives the process. The window reference is
    -- SET NULL rather than CASCADE so tidying up a chat cannot silently drop a
    -- reminder; delivery falls back to the most recent ordinary window.
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      due_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'completed', 'cancelled')),
      chat_window_id INTEGER REFERENCES chat_windows(id) ON DELETE SET NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_pending ON scheduled_jobs(status, due_at);

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      window_id INTEGER REFERENCES chat_windows(id) ON DELETE SET NULL,
      user_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute')),
      budget_json TEXT NOT NULL DEFAULT '{}',
      included_json TEXT NOT NULL DEFAULT '[]',
      omitted_json TEXT NOT NULL DEFAULT '[]',
      prompt_message_count INTEGER NOT NULL DEFAULT 0,
      prompt_chars INTEGER NOT NULL DEFAULT 0,
      estimated_prompt_tokens INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_window_created ON context_snapshots(window_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      chat_window_id INTEGER REFERENCES chat_windows(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'active', 'blocked', 'completed', 'failed', 'cancelled', 'archived')),
      spec_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      active_run_id TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      completed_at DATETIME,
      archived_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_project_status ON agent_tasks(project_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_window_status ON agent_tasks(chat_window_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_active_run ON agent_tasks(active_run_id);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
      phase TEXT NOT NULL DEFAULT 'understanding' CHECK(phase IN ('understanding', 'researching', 'planning', 'awaiting_approval', 'executing', 'verifying', 'completed', 'failed', 'cancelled')),
      scene TEXT NOT NULL DEFAULT 'work',
      strategy TEXT NOT NULL DEFAULT 'reason',
      provider TEXT,
      model TEXT,
      state_json TEXT NOT NULL DEFAULT '{}',
      approval_group_id TEXT,
      -- schema 18: the highest computer permission this run may ever use. It only
      -- ratchets down, so raising the global setting mid-run cannot restore access
      -- the user revoked (AC-06, ATH-SEC-005).
      permission_ceiling TEXT CHECK(permission_ceiling IS NULL OR permission_ceiling IN ('off', 'read', 'files', 'full')),
      error TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      started_at DATETIME,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_created ON agent_runs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_recoverable ON agent_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence > 0),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped')),
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      started_at DATETIME,
      completed_at DATETIME,
      UNIQUE(run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_steps_run_sequence ON agent_steps(run_id, sequence);

    CREATE TABLE IF NOT EXISTS agent_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
      group_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied', 'cancelled')),
      request_json TEXT NOT NULL DEFAULT '{}',
      decision_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      decided_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_agent_approvals_run_group ON agent_approvals(run_id, group_id, status);

    CREATE TABLE IF NOT EXISTS agent_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      uri TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      validation_status TEXT NOT NULL DEFAULT 'pending' CHECK(validation_status IN ('pending', 'passed', 'failed', 'not_applicable')),
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_artifacts_task_created ON agent_artifacts(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run_created ON agent_artifacts(run_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence > 0),
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_sequence ON agent_run_events(run_id, sequence);
    `);

    const messageColumns = database.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!messageColumns.some(column => column.name === 'mode')) {
      database.exec("ALTER TABLE messages ADD COLUMN mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute'))");
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_messages_mode_created_at ON messages(mode, created_at)');
    const attachmentColumns = database.prepare('PRAGMA table_info(chat_attachments)').all() as Array<{ name: string }>;
    if (!attachmentColumns.some(column => column.name === 'content_text')) {
      database.exec(`
        DROP INDEX IF EXISTS idx_chat_attachments_window_status;
        DROP INDEX IF EXISTS idx_chat_attachments_message;
        DROP INDEX IF EXISTS idx_chat_attachments_project;
        ALTER TABLE chat_attachments RENAME TO chat_attachments_before_v15;
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
        INSERT INTO chat_attachments (
          id, window_id, message_id, project_id, kind, mime_type, original_name,
          storage_path, bytes, width, height, content_text, sha256, status, created_at
        )
        SELECT id, window_id, message_id, project_id, kind, mime_type, original_name,
               storage_path, bytes, width, height, NULL, sha256, status, created_at
        FROM chat_attachments_before_v15;
        DROP TABLE chat_attachments_before_v15;
        CREATE INDEX idx_chat_attachments_window_status ON chat_attachments(window_id, status, created_at);
        CREATE INDEX idx_chat_attachments_message ON chat_attachments(message_id, created_at);
        CREATE INDEX idx_chat_attachments_project ON chat_attachments(project_id, created_at);
      `);
    }
    const chatWindowColumns = database.prepare('PRAGMA table_info(chat_windows)').all() as Array<{ name: string }>;
    database.prepare(`
      INSERT INTO projects (title, instructions, memory_state)
      SELECT 'General', '', '{}'
      WHERE NOT EXISTS (
        SELECT 1 FROM projects WHERE deleted_at IS NULL
      )
    `).run();
    const defaultProject = database.prepare(`
      SELECT id
      FROM projects
      WHERE deleted_at IS NULL
      ORDER BY last_active_at DESC, id ASC
      LIMIT 1
    `).get() as { id: number } | undefined;
    if (!chatWindowColumns.some(column => column.name === 'project_id')) {
      database.exec('ALTER TABLE chat_windows ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    if (!chatWindowColumns.some(column => column.name === 'project_instructions_snapshot')) {
      database.exec("ALTER TABLE chat_windows ADD COLUMN project_instructions_snapshot TEXT NOT NULL DEFAULT ''");
    }
    if (defaultProject) {
      database.prepare('UPDATE chat_windows SET project_id = ? WHERE project_id IS NULL').run(defaultProject.id);
    }
    if (!chatWindowColumns.some(column => column.name === 'is_temporary')) {
      database.exec("ALTER TABLE chat_windows ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0 CHECK(is_temporary IN (0, 1))");
    }
    const dailySummaryColumns = database.prepare('PRAGMA table_info(daily_memory_summaries)').all() as Array<{ name: string }>;
    if (!dailySummaryColumns.some(column => column.name === 'summary_method')) {
      database.exec("ALTER TABLE daily_memory_summaries ADD COLUMN summary_method TEXT NOT NULL DEFAULT 'heuristic' CHECK(summary_method IN ('heuristic', 'llm-refined'))");
    }
    const reviewColumns = database.prepare('PRAGMA table_info(memory_review_queue)').all() as Array<{ name: string }>;
    if (!reviewColumns.some(column => column.name === 'group_key')) {
      database.exec('ALTER TABLE memory_review_queue ADD COLUMN group_key TEXT');
    }
    const proceduralColumns = database.prepare('PRAGMA table_info(procedural_memories)').all() as Array<{ name: string }>;
    if (!proceduralColumns.some(column => column.name === 'project_id')) {
      database.exec(`
        DROP INDEX IF EXISTS idx_procedural_memories_scope;
        DROP INDEX IF EXISTS idx_procedural_memories_updated;
        ALTER TABLE procedural_memories RENAME TO procedural_memories_before_v12;
        CREATE TABLE procedural_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'project', 'mode', 'tool', 'persona')),
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          key TEXT NOT NULL,
          instruction TEXT NOT NULL,
          evidence TEXT,
          confidence REAL DEFAULT 0.7,
          importance INTEGER DEFAULT 6,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
          created_at DATETIME DEFAULT (datetime('now', 'localtime')),
          updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
          last_recalled_at DATETIME,
          CHECK(scope = 'project' OR project_id IS NULL)
        );
        INSERT INTO procedural_memories (
          id, scope, project_id, key, instruction, evidence, confidence, importance,
          status, created_at, updated_at, last_recalled_at
        )
        SELECT id, scope, NULL, key, instruction, evidence, confidence, importance,
               status, created_at, updated_at, last_recalled_at
        FROM procedural_memories_before_v12;
        DROP TABLE procedural_memories_before_v12;
      `);
    }
    const projectNoteColumns = database.prepare('PRAGMA table_info(project_notes)').all() as Array<{ name: string }>;
    if (!projectNoteColumns.some(column => column.name === 'project_id')) {
      database.exec('ALTER TABLE project_notes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      database.exec(`
        UPDATE project_notes AS pn
        SET project_id = (
          SELECT MIN(p.id)
          FROM projects p
          WHERE trim(p.title) = trim(pn.project) COLLATE NOCASE
          HAVING COUNT(*) = 1
        )
        WHERE project_id IS NULL
      `);
    }
    const contextSnapshotColumns = database.prepare('PRAGMA table_info(context_snapshots)').all() as Array<{ name: string }>;
    if (!contextSnapshotColumns.some(column => column.name === 'project_id')) {
      database.exec('ALTER TABLE context_snapshots ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      database.exec(`
        UPDATE context_snapshots
        SET project_id = (
          SELECT cw.project_id FROM chat_windows cw WHERE cw.id = context_snapshots.window_id
        )
        WHERE project_id IS NULL AND window_id IS NOT NULL
      `);
    }
    const memoryIndexColumns = database.prepare('PRAGMA table_info(memory_index)').all() as Array<{ name: string }>;
    if (!memoryIndexColumns.some(column => column.name === 'semantic_vector')) {
      database.exec("ALTER TABLE memory_index ADD COLUMN semantic_vector TEXT NOT NULL DEFAULT '[]'");
    }
    if (!memoryIndexColumns.some(column => column.name === 'project_id')) {
      database.exec('ALTER TABLE memory_index ADD COLUMN project_id INTEGER');
      database.exec(`
        UPDATE memory_index
        SET project_id = (
          SELECT pn.project_id FROM project_notes pn WHERE pn.id = memory_index.source_id
        )
        WHERE source_table = 'project_notes'
      `);
      database.exec(`
        UPDATE memory_index
        SET project_id = (
          SELECT CASE WHEN pm.scope = 'project' THEN pm.project_id ELSE 0 END
          FROM procedural_memories pm
          WHERE pm.id = memory_index.source_id
        )
        WHERE source_table = 'procedural_memories'
      `);
    }
    const projectDocumentColumns = database.prepare('PRAGMA table_info(project_documents)').all() as Array<{ name: string }>;
    if (!projectDocumentColumns.some(column => column.name === 'ocr_engine')) {
      database.exec("ALTER TABLE project_documents ADD COLUMN ocr_engine TEXT CHECK(ocr_engine IS NULL OR ocr_engine = 'tesseract.js')");
    }
    if (!projectDocumentColumns.some(column => column.name === 'ocr_languages')) {
      database.exec("ALTER TABLE project_documents ADD COLUMN ocr_languages TEXT NOT NULL DEFAULT '[]'");
    }
    if (!projectDocumentColumns.some(column => column.name === 'needs_ocr')) {
      database.exec('ALTER TABLE project_documents ADD COLUMN needs_ocr INTEGER NOT NULL DEFAULT 0 CHECK(needs_ocr IN (0, 1))');
    }
    // schema 16: messages written while "save chat history" is off are kept only
    // for the running session and purged at startup (ATH-DATA-002).
    const chatMessageColumns = database.prepare('PRAGMA table_info(chat_messages)').all() as Array<{ name: string }>;
    if (!chatMessageColumns.some(column => column.name === 'ephemeral')) {
      database.exec('ALTER TABLE chat_messages ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0 CHECK(ephemeral IN (0, 1))');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_ephemeral ON chat_messages(ephemeral) WHERE ephemeral = 1');
    // schema 18: per-run computer permission ceiling (ATH-SEC-005).
    const agentRunColumns = database.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>;
    if (!agentRunColumns.some(column => column.name === 'permission_ceiling')) {
      database.exec("ALTER TABLE agent_runs ADD COLUMN permission_ceiling TEXT CHECK(permission_ceiling IS NULL OR permission_ceiling IN ('off', 'read', 'files', 'full'))");
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_chat_windows_temporary ON chat_windows(is_temporary, deleted_at, archived_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_chat_windows_project ON chat_windows(project_id, deleted_at, archived_at, last_active_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_memory_review_queue_group ON memory_review_queue(group_key, status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_procedural_memories_scope ON procedural_memories(scope, status, importance DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_procedural_memories_updated ON procedural_memories(updated_at DESC)');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_procedural_memories_unscoped_key ON procedural_memories(scope, key) WHERE project_id IS NULL');
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_procedural_memories_project_key ON procedural_memories(project_id, key) WHERE scope = 'project' AND project_id IS NOT NULL");
    database.exec('CREATE INDEX IF NOT EXISTS idx_project_notes_project_id ON project_notes(project_id, status, importance DESC, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_context_snapshots_project_created ON context_snapshots(project_id, created_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_memory_index_project_source ON memory_index(source_table, project_id, source_id)');
    if (process.env.ATHENA_TEST_FAIL_MIGRATION === '1') throw new Error('Injected migration failure');
    database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
  });
  migrate();
}

function countRows(database: Database.Database, tableName: string): number {
  return (database.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number }).c;
}

function countWhere(database: Database.Database, tableName: string, where: string): number {
  return (database.prepare(`SELECT COUNT(*) as c FROM ${tableName} WHERE ${where}`).get() as { c: number }).c;
}

function getDatabasePath(): string {
  if (resolvedDbPath) return resolvedDbPath;
  resolvedDbPath = path.join(resolveDatabaseDir(), process.env.ATHENA_DB_FILENAME || 'athena.db');
  return resolvedDbPath;
}

function resolveDatabaseDir(): string {
  const configured = process.env.ATHENA_DB_DIR;
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }

  const userDataDir = resolvePackagedUserDataDir();
  if (userDataDir) return path.join(userDataDir, 'database');

  return path.join(resolveProjectRoot(), 'database');
}

function resolvePackagedUserDataDir(): string | null {
  try {
    const requireFromHere = createRequire(__filename);
    const electron = requireFromHere('electron') as { app?: { isPackaged?: boolean; getPath?: (name: string) => string } };
    if (electron.app?.isPackaged && electron.app.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Non-Electron contexts, such as scripts, should stay on the workspace database.
  }
  return null;
}

function seedPackagedDatabase(targetPath: string): void {
  if (fs.existsSync(targetPath)) return;

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return;

  const sourcePath = path.join(resourcesPath, 'database', path.basename(targetPath));
  if (!fs.existsSync(sourcePath)) return;

  fs.copyFileSync(sourcePath, targetPath);
}

function copySidecarIfPresent(sourcePath: string, targetPath: string): void {
  if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath);
}

function restoreSidecarIfPresent(sourcePath: string, targetPath: string): void {
  try {
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath);
    else if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
  } catch {
    // Sidecar recovery should not hide the primary database restoration.
  }
}

function removeIfPresent(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch {
    // Restoration will surface the primary copy failure if the database is not writable.
  }
}
