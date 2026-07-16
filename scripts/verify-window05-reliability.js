const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-window05-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice');
process.env.ATHENA_DIAGNOSTICS_DIR = path.join(scratch, 'diagnostics');
process.env.ATHENA_DB_BUSY_TIMEOUT_MS = '120';
process.env.ATHENA_PYTHON = path.join(scratch, 'missing-python.exe');
process.env.ATHENA_WHISPER_MODEL_DIR = path.join(scratch, 'missing-whisper-model');
process.env.ATHENA_TTS_VOICE = '';

const { ensureSufficientDiskSpace, InsufficientDiskSpaceError } = require('../dist/core/runtime/DiskSpaceGuard.js');
const { recordCrashDiagnostic } = require('../dist/core/runtime/CrashDiagnostics.js');
const { getSettingsBundle, saveSettingsBundle, buildPersonalizationPrompt } = require('../dist/core/config/SettingsStore.js');
const { getDatabase, getDatabaseFilePath, closeDatabase, retrieveContext } = require('../dist/memory/index.js');
const { VoiceService } = require('../dist/core/voice/VoiceService.js');

async function main() {
  assert.throws(() => ensureSufficientDiskSpace(scratch, 16 * 1024 * 1024, 1024), InsufficientDiskSpaceError);

  const diagnosticPath = recordCrashDiagnostic('disk-full', { apiKey: 'sk-proj-secret-value', message: 'disk probe' });
  const diagnostic = fs.readFileSync(diagnosticPath, 'utf8');
  assert.match(diagnostic, /disk-full/);
  assert.doesNotMatch(diagnostic, /sk-proj-secret-value/);
  assert.match(diagnostic, /REDACTED/);

  const voice = await new VoiceService().getCapabilities();
  assert.strictEqual(voice.runtimeDownloadsAllowed, false);
  assert.strictEqual(voice.onlineStt.available, false);
  assert.strictEqual(voice.onlineTts.available, false);
  assert.strictEqual(voice.stt.ready, false);
  assert.match(voice.stt.reason, /运行时未安装|模型缺失/);
  assert.strictEqual(voice.tts.ready, true, voice.tts.reason);
  const localTts = await new VoiceService().synthesize('Athena local voice readiness test.');
  assert.strictEqual(localTts.ok, true, localTts.error);
  assert(localTts.audioPath && fs.existsSync(localTts.audioPath), 'local SAPI TTS must produce a WAV file without network');

  let bundle = saveSettingsBundle({ settings: {
    general: { launchAtStartup: false, closeToTray: true, desktopNotifications: false, autoConnectModel: false },
    appearance: { theme: 'night', animationLevel: 'low', glassEffects: false },
    conversation: { activeMode: 'create', enterToSend: false, streamResponses: false, showTimestamps: true, saveHistory: true },
    webSearch: { enabled: false, mode: 'manual', maxResults: 3, deepRead: false, secondarySearch: false, maxPages: 1 },
    personalization: { userName: '设置探针', preferredAddress: '测试者', tone: 'direct', replyLength: 'short', initiative: 'low', proactiveCare: false, useMemoryInSmallTalk: false, creatorModeHints: false, customNotes: 'runtime-probe' },
    memory: { enabled: true, autoExtract: false, retrieveProfile: false, retrieveEvents: false, retrieveProjects: false, retrievalDepth: 1, minImportanceForAutoExtract: 10 },
    voice: { sttEnabled: false, ttsEnabled: false, autoPlayAssistant: false, sttEngine: 'local_whisper', ttsVoice: '', silenceAutoStop: false },
    data: { confirmBeforeDelete: false, historyRetentionDays: 1, voiceCacheRetentionHours: 1, exportFormat: 'markdown' },
    ui: { startupIntro: false, compactMode: true },
  }, model: { ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'settings-probe', temperature: 0.2, maxTokens: 512, numCtx: 2048 } } });
  assert.strictEqual(getSettingsBundle().settings.general.closeToTray, true);
  assert.strictEqual(bundle.settings.conversation.streamResponses, false);
  assert.strictEqual(bundle.settings.data.exportFormat, 'markdown');
  assert.match(buildPersonalizationPrompt(), /设置探针/);
  assert.strictEqual(bundle.model.ollama.model, 'settings-probe');

  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const visibleIds = [...html.matchAll(/id="(setting-[^"]+)"/g)].map(match => match[1]);
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/app.ts'), 'utf8');
  for (const id of visibleIds) assert(renderer.includes(`'${id}'`), `${id} is visible but not wired by the renderer`);
  assert(!visibleIds.includes('setting-stt-engine'), 'Removed online/auto STT selector must stay out of release UI');
  assert(!visibleIds.includes('setting-consent-online-stt') && !visibleIds.includes('setting-consent-online-tts'), 'Unavailable online voice consents must not be visible settings');

  const db = getDatabase();
  const insert = db.prepare("INSERT INTO messages (role, content, mode) VALUES ('user', ?, 'companion')");
  const beforeHeap = process.memoryUsage().heapUsed;
  const transaction = db.transaction(() => { for (let index = 0; index < 1500; index += 1) insert.run(`long-session-${index}`); });
  transaction();
  for (let index = 0; index < 100; index += 1) {
    const context = retrieveContext({ query: 'long session probe', recentMessageCount: 20, maxProfileFacts: 0, maxEvents: 0, maxProjectNotes: 0 });
    assert(context.recentMessages.length <= 20);
  }
  const heapGrowth = process.memoryUsage().heapUsed - beforeHeap;
  assert(heapGrowth < 64 * 1024 * 1024, `long-session heap growth was ${heapGrowth}`);

  const blocker = new Database(getDatabaseFilePath());
  blocker.exec('BEGIN EXCLUSIVE');
  const lockStarted = Date.now();
  assert.throws(() => insert.run('locked-write'), error => error && error.code === 'SQLITE_BUSY');
  const lockWaitMs = Date.now() - lockStarted;
  assert(lockWaitMs >= 80 && lockWaitMs < 1500, `busy timeout was not bounded: ${lockWaitMs}ms`);
  blocker.exec('ROLLBACK');
  blocker.close();

  console.log(`ATHENA_WINDOW05_RELIABILITY_OK longMessages=1500 heapGrowth=${heapGrowth} lockWaitMs=${lockWaitMs}`);
}

main().finally(() => {
  try { closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
}).catch(error => { console.error(error); process.exitCode = 1; });
