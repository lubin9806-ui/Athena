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
  const memoryStats = databaseModule.getStats();
  const contentCounts = Object.entries(memoryStats)
    .filter(([key]) => key !== 'dbSize')
    .map(([key, value]) => [key, Number(value)]);
  const nonEmpty = contentCounts.filter(([, value]) => value !== 0);
  if (nonEmpty.length > 0) {
    throw new Error(`Release seed database contains user or memory content: ${JSON.stringify(Object.fromEntries(nonEmpty))}`);
  }
  database.pragma('wal_checkpoint(TRUNCATE)');
  databaseModule.closeDatabase();
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
  console.log(`ATHENA_SEED_DATABASE_OK schema=${schemaVersion} contentRows=0 path=${databasePath}`);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
