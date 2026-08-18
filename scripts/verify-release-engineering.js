const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ROOT,
  buildInputHash,
  packageMetadata,
  readJson,
  releaseChannel,
  sha256,
  sha512Base64,
  writeJson,
  normalizeUpdateBaseUrl,
} = require('./release-common');
const { rollback, setPaused, stageCandidate } = require('./channel-control');
const { DATABASE_SCHEMA_VERSION } = require(path.join(ROOT, 'dist', 'memory', 'database', 'index.js'));

function verifyVersionIdentity() {
  const pkg = packageMetadata();
  const lock = readJson(path.join(ROOT, 'package-lock.json'));
  const constants = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'constants', 'index.ts'), 'utf8');
  assert.strictEqual(pkg.version, '0.9.6-beta.1');
  assert.strictEqual(lock.version, pkg.version);
  assert.strictEqual(lock.packages[''].version, pkg.version);
  assert.match(constants, /APP_VERSION = packageMetadata\.version/);
  assert.strictEqual(releaseChannel(pkg.version), 'beta');
  assert.strictEqual(releaseChannel('0.9.0'), 'stable');
  assert.strictEqual(normalizeUpdateBaseUrl('https://updates.example.test/athena/'), 'https://updates.example.test/athena');
  assert.strictEqual(normalizeUpdateBaseUrl('https://user:pass@updates.example.test/athena'), null);
  assert.strictEqual(normalizeUpdateBaseUrl('https://updates.example.test:444/athena'), null);
  assert.strictEqual(normalizeUpdateBaseUrl('https://updates.example.test/athena/../other'), null);
  assert.strictEqual(normalizeUpdateBaseUrl(' https://updates.example.test/athena'), null);
  assert.strictEqual(pkg.dependencies['electron-updater'], '6.8.9');
  const builder = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  assert.match(builder, /signAndEditExecutable: true/);
  assert.match(builder, /from: \.build\/database/);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'desktop-beta.yml'), 'utf8');
  for (const required of ['actions/checkout@v4', 'npm.cmd ci', 'release:preflight', 'build:release', 'test:desktop-package', 'release:verify-candidate', '--require-clean', 'WINDOWS_CSC_LINK', 'WINDOWS_SIGNING_PUBLISHER', 'ATHENA_UPDATE_BASE_URL', 'GITHUB_REF_NAME', 'desktop-v$version']) {
    assert(workflow.includes(required), `clean-checkout CI is missing: ${required}`);
  }
  const candidateGenerator = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-candidate-manifest.js'), 'utf8');
  assert.match(candidateGenerator, /buildInfo\.shortCommit/);
  assert.doesNotMatch(candidateGenerator, /state\.shortCommit/);
  assert.strictEqual(buildInputHash(), buildInputHash());
}

function fixtureCandidate(root, version, id) {
  const candidateRoot = path.join(root, id);
  fs.mkdirSync(candidateRoot, { recursive: true });
  const artifact = path.join(candidateRoot, `Athena Setup ${version}.exe`);
  fs.writeFileSync(artifact, `fixture-${id}`, 'utf8');
  const manifestPath = path.join(candidateRoot, 'candidate-manifest.json');
  writeJson(manifestPath, {
    schemaVersion: 1,
    fixture: true,
    candidateId: id,
    product: 'Athena Desktop test fixture',
    version,
    channel: releaseChannel(version),
    artifacts: [{
      file: path.basename(artifact),
      bytes: fs.statSync(artifact).size,
      sha256: sha256(artifact),
      sha512: sha512Base64(artifact),
      authenticode: { status: 'FixtureOnly', valid: true },
    }],
    distributionAllowed: true,
    blockers: [],
    betaValidation: { requiredParticipants: { minimum: 20, maximum: 50 }, completedParticipants: 0, status: 'NOT_STARTED' },
  });
  return manifestPath;
}

function verifyChannelControls(scratch) {
  const candidates = path.join(scratch, 'fixtures');
  const feed = path.join(scratch, 'feed');
  const beta1 = fixtureCandidate(candidates, '0.9.0-beta.1', 'beta-1');
  const beta2 = fixtureCandidate(candidates, '0.9.0-beta.2', 'beta-2');
  stageCandidate(feed, 'beta', beta1, { allowFixture: true });
  stageCandidate(feed, 'beta', beta2, { allowFixture: true });
  assert.strictEqual(readJson(path.join(feed, 'channels', 'beta', 'latest.json')).version, '0.9.0-beta.2');
  assert.match(fs.readFileSync(path.join(feed, 'channels', 'beta', 'beta.yml'), 'utf8'), /version: 0\.9\.0-beta\.2/);
  setPaused(feed, 'beta', true, 'QA incident rehearsal');
  assert.strictEqual(readJson(path.join(feed, 'channels', 'beta', 'control.json')).paused, true);
  setPaused(feed, 'beta', false, '');
  assert.strictEqual(readJson(path.join(feed, 'channels', 'beta', 'control.json')).paused, false);
  rollback(feed, 'beta', beta1, 'Rollback rehearsal', { allowFixture: true });
  assert.strictEqual(readJson(path.join(feed, 'channels', 'beta', 'latest.json')).version, '0.9.0-beta.1');
  assert.strictEqual(readJson(path.join(feed, 'channels', 'beta', 'rollback.json')).targetCandidateId, 'beta-1');

  const dishonest = readJson(beta1);
  dishonest.betaValidation.status = 'PASSED';
  dishonest.betaValidation.completedParticipants = 19;
  writeJson(beta1, dishonest);
  assert.throws(() => stageCandidate(feed, 'beta', beta1, { allowFixture: true }), /fewer than 20/);
}

function verifyMigrationRecovery(scratch) {
  const databaseDir = path.join(scratch, 'migration-database');
  fs.mkdirSync(databaseDir, { recursive: true });
  const databasePath = path.join(databaseDir, 'athena.db');
  const Database = require('better-sqlite3');
  const legacy = new Database(databasePath);
  legacy.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, emotion TEXT, created_at DATETIME DEFAULT (datetime('now', 'localtime'))); INSERT INTO messages(role, content) VALUES ('user', 'migration sentinel'); PRAGMA user_version = 0;");
  legacy.close();

  const probe = "const db=require('./dist/memory/database/index.js'); try { const opened=db.getDatabase(); console.log('schema='+opened.pragma('user_version',{simple:true})); db.closeDatabase(); } catch(error) { console.error(error.message); process.exit(23); }";
  const failed = spawnSync(process.execPath, ['-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ATHENA_DB_DIR: databaseDir, ATHENA_TEST_FAIL_MIGRATION: '1' },
  });
  assert.strictEqual(failed.status, 23, `injected migration should fail: ${failed.stdout} ${failed.stderr}`);
  const restored = new Database(databasePath, { readonly: true });
  assert.strictEqual(restored.prepare('SELECT content FROM messages WHERE id = 1').get().content, 'migration sentinel');
  assert.strictEqual(restored.pragma('user_version', { simple: true }), 0);
  restored.close();

  const succeeded = spawnSync(process.execPath, ['-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ATHENA_DB_DIR: databaseDir },
  });
  assert.strictEqual(succeeded.status, 0, `migration should recover: ${succeeded.stdout} ${succeeded.stderr}`);
  assert.match(succeeded.stdout, new RegExp(`schema=${DATABASE_SCHEMA_VERSION}`));
  const backups = fs.readdirSync(path.join(databaseDir, 'backups')).filter(name => name.endsWith('.bak'));
  assert(backups.length >= 1, 'at least one pre-migration backup must remain');
}

function verifyVersion3ChatWindowMigration(scratch) {
  const databaseDir = path.join(scratch, 'migration-v3-database');
  fs.mkdirSync(databaseDir, { recursive: true });
  const databasePath = path.join(databaseDir, 'athena.db');
  const Database = require('better-sqlite3');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE chat_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'companion' CHECK(mode IN ('create', 'companion', 'reason', 'execute')),
      working_state TEXT NOT NULL DEFAULT '{}',
      archived_at DATETIME,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_active_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO chat_windows(title) VALUES ('legacy window');
    PRAGMA user_version = 3;
  `);
  legacy.close();

  const probe = `
    const db=require('./dist/memory/database/index.js');
    try {
      const opened=db.getDatabase();
      const columns=opened.prepare('PRAGMA table_info(chat_windows)').all().map(column => column.name);
      console.log('schema='+opened.pragma('user_version',{simple:true}));
      console.log('columns='+columns.join(','));
      console.log('window='+JSON.stringify(opened.prepare('SELECT project_id, is_temporary FROM chat_windows WHERE id=1').get()));
      db.closeDatabase();
    } catch(error) {
      console.error(error.message);
      process.exit(23);
    }
  `;
  const migrated = spawnSync(process.execPath, ['-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ATHENA_DB_DIR: databaseDir },
  });
  assert.strictEqual(migrated.status, 0, `v3 chat window migration should recover: ${migrated.stdout} ${migrated.stderr}`);
  assert.match(migrated.stdout, new RegExp(`schema=${DATABASE_SCHEMA_VERSION}`));
  assert.match(migrated.stdout, /project_id/);
  assert.match(migrated.stdout, /is_temporary/);
}

function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-release-engineering-'));
  try {
    verifyVersionIdentity();
    verifyChannelControls(scratch);
    verifyMigrationRecovery(scratch);
    verifyVersion3ChatWindowMigration(scratch);
    console.log('ATHENA_RELEASE_ENGINEERING_OK version=0.9.6-beta.1 channels=beta,stable migrationBackup=verified rollback=verified');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
