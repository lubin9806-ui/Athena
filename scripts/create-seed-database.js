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
  database.pragma('wal_checkpoint(TRUNCATE)');
  databaseModule.closeDatabase();
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
  console.log(`ATHENA_SEED_DATABASE_OK schema=${schemaVersion} path=${databasePath}`);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
