import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveProjectRoot } from '../../core/runtime/Paths';

let db: Database.Database | null = null;
let resolvedDbPath: string | null = null;

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
  seedPackagedDatabase(dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
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

function runMigrations(database: Database.Database): void {
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
  `);

  const messageColumns = database.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
  if (!messageColumns.some(column => column.name === 'mode')) {
    database.exec("ALTER TABLE messages ADD COLUMN mode TEXT CHECK(mode IN ('create', 'companion', 'reason', 'execute'))");
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_mode_created_at ON messages(mode, created_at)');
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
