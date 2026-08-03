const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-privacy-data-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice');
process.env.ATHENA_EXPORT_DIR = path.join(scratch, 'exports');

const {
  getSettingsBundle,
  saveSettingsBundle,
} = require('../dist/core/config/SettingsStore.js');
const {
  applyDataRetention,
  canUseNetworkCapability,
  cleanupVoiceCache,
  clearAllLocalData,
  exportAllData,
  getPrivacyCenterState,
  recordDataActivity,
} = require('../dist/core/privacy/PrivacyDataService.js');
const {
  backupDatabaseBeforeMigration,
  closeDatabase,
  getDatabase,
  getDatabaseFilePath,
} = require('../dist/memory/database/index.js');
const { ComputerToolService } = require('../dist/core/tools/ComputerTools.js');

function tableCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function writeVoiceCache(name, ageHours) {
  fs.mkdirSync(process.env.ATHENA_VOICE_TEMP_DIR, { recursive: true });
  const filePath = path.join(process.env.ATHENA_VOICE_TEMP_DIR, name);
  fs.writeFileSync(filePath, 'voice-cache');
  const time = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  fs.utimesSync(filePath, time, time);
  return filePath;
}

(async () => {
  try {
    let bundle = getSettingsBundle();
    assert.strictEqual(bundle.settings.privacy.networkConsent.remoteModel, false);
    assert.strictEqual(bundle.settings.privacy.networkConsent.webSearch, false);
    assert.strictEqual(canUseNetworkCapability('remoteModel'), false);
    assert.strictEqual(canUseNetworkCapability('webSearch'), false);

    bundle = saveSettingsBundle({
      settings: {
        conversation: { saveHistory: false },
        memory: { autoExtract: true },
        data: { historyRetentionDays: 7, voiceCacheRetentionHours: 1, exportFormat: 'json' },
        privacy: {
          networkConsent: {
            remoteModel: true,
            webSearch: true,
            onlineSpeechToText: true,
            onlineTextToSpeech: true,
            externalToolNetwork: false,
          },
        },
      },
    });
    assert.strictEqual(bundle.settings.conversation.saveHistory, false);
    assert.strictEqual(canUseNetworkCapability('remoteModel'), true);
    assert.strictEqual(canUseNetworkCapability('webSearch'), true);

    const db = getDatabase();
    recordDataActivity('search', 'should-not-persist-while-history-off', { query: 'secret' });
    assert.strictEqual(tableCount(db, 'data_activity_records'), 0);

    saveSettingsBundle({
      settings: {
        conversation: { saveHistory: true },
        data: { historyRetentionDays: 7, voiceCacheRetentionHours: 1, exportFormat: 'json' },
      },
    });
    db.prepare("INSERT INTO messages (role, content, created_at) VALUES ('user', 'old', '2020-01-01T00:00:00.000Z')").run();
    const oldMessageId = db.prepare("SELECT id FROM messages WHERE content = 'old'").get().id;
    db.prepare("INSERT INTO memory_index (source_table, source_id, keywords) VALUES ('messages', ?, 'old')").run(oldMessageId);
    db.prepare("INSERT INTO messages (role, content, created_at) VALUES ('user', 'new', datetime('now', 'localtime'))").run();
    db.prepare("INSERT INTO data_activity_records (category, action, detail_json, created_at) VALUES ('search', 'old', '{}', '2020-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO data_activity_records (category, action, detail_json) VALUES ('search', 'new', '{}')").run();
    const retention = applyDataRetention(new Date('2026-07-15T12:00:00.000Z'));
    assert.strictEqual(retention.messagesDeleted, 1);
    assert.strictEqual(retention.activityDeleted, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM memory_index WHERE source_table = 'messages' AND source_id = ?").get(oldMessageId).c, 0);

    const oldVoice = writeVoiceCache('old.mp3', 3);
    const freshVoice = writeVoiceCache('fresh.mp3', 0);
    assert.strictEqual(cleanupVoiceCache(1), 1);
    assert.strictEqual(fs.existsSync(oldVoice), false);
    assert.strictEqual(fs.existsSync(freshVoice), true);

    const center = getPrivacyCenterState();
    const requiredMapIds = ['chat', 'long-term-memory', 'settings', 'search', 'voice', 'tools', 'logs', 'temporary-files'];
    assert.deepStrictEqual(requiredMapIds.every(id => center.dataMap.some(item => item.id === id)), true);
    assert.strictEqual(center.staticProtection.status, 'plaintext-sqlite-with-compensating-controls');
    assert.match(center.staticProtection.claim, /未加密/);

    const backupPath = backupDatabaseBeforeMigration(getDatabaseFilePath(), new Date('2026-07-15T12:00:00.000Z'));
    assert(backupPath && fs.existsSync(backupPath), 'migration backup should be created');

    const service = new ComputerToolService();
    const denied = await service.execute('http_request', { url: 'https://example.com/' }, {
      permissionLevel: 'full',
      modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'full' },
      maxToolRounds: 1,
      commandTimeoutSeconds: 5,
      allowExternalNetwork: false,
    });
    assert.strictEqual(denied.status, 'denied');
    assert.match(denied.output, /external_tool_network_consent_required/);

    const exported = exportAllData('json');
    assert(fs.existsSync(exported.path), 'data export should exist');
    const exportedJson = JSON.parse(fs.readFileSync(exported.path, 'utf8'));
    assert.strictEqual(exportedJson.staticProtection.status, 'plaintext-sqlite-with-compensating-controls');
    assert(exportedJson.database.messages.some(row => row.content === 'new'));
    assert(exportedJson.files.voiceCache.some(file => file.path === freshVoice && file.contentBase64));

    db.prepare("INSERT INTO profile (category, fact) VALUES ('preference', 'clear me')").run();
    db.prepare("INSERT INTO events (date, summary) VALUES ('2026-07-15', 'clear event')").run();
    db.prepare("INSERT INTO project_notes (project, title, note) VALUES ('Athena', 'clear project', 'clear note')").run();
    const cleared = clearAllLocalData();
    assert(cleared.deletedTables.includes('messages'));
    for (const table of ['messages', 'profile', 'events', 'project_notes', 'memory_index', 'data_activity_records']) {
      assert.strictEqual(tableCount(db, table), 0, `${table} should be empty after clear`);
    }
    assert.strictEqual(fs.existsSync(freshVoice), false);

    closeDatabase();
    console.log('ATHENA_PRIVACY_DATA_OK');
    process.exit(0);
  } finally {
    try { closeDatabase(); } catch {}
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  try { closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
});
