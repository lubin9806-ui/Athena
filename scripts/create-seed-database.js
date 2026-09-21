const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const databaseDir = path.join(root, '.build', 'database');
const databasePath = path.join(databaseDir, 'athena.db');

try {
  fs.mkdirSync(databaseDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${databasePath}${suffix}`;
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
  process.env.ATHENA_DB_DIR = databaseDir;
  process.env.ATHENA_DB_FILENAME = 'athena.db';
  const databaseModule = require('../dist/memory/database/index.js');
  const database = databaseModule.getDatabase();
  const schemaVersion = database.pragma('user_version', { simple: true });
  const emptyContentTables = [
    'messages', 'chat_windows', 'chat_messages', 'chat_attachments', 'profile', 'events',
    'daily_memory_summaries', 'procedural_memories', 'memory_entities', 'memory_facts',
    'memory_fact_sources', 'memory_review_queue', 'project_notes', 'project_documents',
    'project_document_chunks', 'memory_index', 'data_activity_records', 'scheduled_jobs',
    'context_snapshots', 'agent_tasks', 'agent_runs', 'agent_steps', 'agent_approvals',
    'agent_artifacts', 'agent_run_events',
  ];
  const contentCounts = emptyContentTables.map(table => [
    table,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]);
  const nonEmpty = contentCounts.filter(([, value]) => value !== 0);
  if (nonEmpty.length > 0) {
    throw new Error(`Release seed database contains user or memory content: ${JSON.stringify(Object.fromEntries(nonEmpty))}`);
  }
  const projects = database.prepare(`
    SELECT id, title, instructions, memory_state, archived_at, deleted_at
    FROM projects
  `).all();
  const cleanDefaultProject = projects.length === 1
    && projects[0].id === 1
    && projects[0].title === 'General'
    && projects[0].instructions === ''
    && projects[0].memory_state === '{}'
    && projects[0].archived_at === null
    && projects[0].deleted_at === null;
  if (!cleanDefaultProject) {
    throw new Error('Release seed database must contain only the empty General system project.');
  }
  database.pragma('wal_checkpoint(TRUNCATE)');
  databaseModule.closeDatabase();
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
  console.log(`ATHENA_SEED_DATABASE_OK schema=${schemaVersion} contentRows=0 systemProjects=1 path=${databasePath}`);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
