import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveProjectRoot } from '../../core/runtime/Paths';
import { ensureSufficientDiskSpace } from '../../core/runtime/DiskSpaceGuard';

let db: Database.Database | null = null;
let resolvedDbPath: string | null = null;
export const DATABASE_SCHEMA_VERSION = 1;
const MIGRATION_BACKUP_RETENTION = 5;

export interface MemoryStats {
  messageCount: number;
  profileCount: number;
  eventCount: number;
  projectNoteCount: number;
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
  db.close();
  db = null;
}

export function getStats(): MemoryStats {
  const database = getDatabase();
  const messageCount = countRows(database, 'messages');
  const profileCount = countRows(database, 'profile');
  const eventCount = countRows(database, 'events');
  const projectNoteCount = countRows(database, 'project_notes');
  const indexCount = countRows(database, 'memory_index');

  let dbSize = '0 MB';
  try {
    const stats = fs.statSync(getDatabasePath());
    dbSize = `${(stats.size / (1024 * 1024)).toFixed(2)} MB`;
  } catch {
    // The file may not exist yet on very first startup.
  }

  return { messageCount, profileCount, eventCount, projectNoteCount, indexCount, dbSize };
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

    CREATE TABLE IF NOT EXISTS project_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    CREATE TABLE IF NOT EXISTS memory_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      keywords TEXT NOT NULL,
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
    `);

    const messageColumns = database.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!messageColumns.some(column => column.name === 'mode')) {
      database.exec("ALTER TABLE messages ADD COLUMN mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute'))");
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_messages_mode_created_at ON messages(mode, created_at)');
    if (process.env.ATHENA_TEST_FAIL_MIGRATION === '1') throw new Error('Injected migration failure');
    database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
  });
  migrate();
}

function countRows(database: Database.Database, tableName: string): number {
  return (database.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number }).c;
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
