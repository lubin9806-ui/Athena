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
const {
  countEphemeralChatMessages,
  createChatWindow,
  purgeEphemeralChatMessages,
  saveChatMessage,
  saveContextSnapshot,
} = require('../dist/memory/index.js');
const { globalScheduler } = require('../dist/engine/Scheduler.js');
const { Reminder } = require('../dist/core/scheduler/Reminder.js');
const {
  createScheduledJob,
  getScheduledJob,
  listPendingScheduledJobs,
} = require('../dist/core/scheduler/ScheduledJobStore.js');
const { ComputerToolService } = require('../dist/core/tools/ComputerTools.js');
const { AgentStore } = require('../dist/core/agent/index.js');

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
    assert.strictEqual(bundle.settings.privacy.networkConsent.imageGeneration, false);
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
            imageGeneration: true,
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
    assert.strictEqual(canUseNetworkCapability('imageGeneration'), true);

    const db = getDatabase();
    recordDataActivity('search', 'should-not-persist-while-history-off', { query: 'secret' });
    assert.strictEqual(tableCount(db, 'data_activity_records'), 0);

    // ATH-DATA-002: with history off a turn still has to work for the running
    // session, but it must not leave a durable copy anywhere. The window summary
    // and working state carry message text, so they are the easy thing to miss.
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('chat_messages') WHERE name = 'ephemeral'").get().c,
      1,
      'schema 16 must add chat_messages.ephemeral',
    );

    const historyOffWindow = createChatWindow({ title: 'history-off window' });
    const ephemeralSecret = 'ephemeral-secret-must-not-outlive-session';
    const ephemeralMessage = saveChatMessage(historyOffWindow.id, 'user', ephemeralSecret, undefined, 'companion', true);
    assert.ok(ephemeralMessage, 'history-off turn must still be readable this session');
    assert.strictEqual(
      db.prepare('SELECT content FROM chat_messages WHERE id = ?').get(ephemeralMessage.id).content,
      ephemeralSecret,
    );
    assert.strictEqual(db.prepare('SELECT ephemeral FROM chat_messages WHERE id = ?').get(ephemeralMessage.id).ephemeral, 1);
    const afterEphemeral = db.prepare('SELECT summary, working_state FROM chat_windows WHERE id = ?').get(historyOffWindow.id);
    assert.ok(!afterEphemeral.summary.includes(ephemeralSecret), 'window summary retained history-off content');
    assert.ok(!afterEphemeral.working_state.includes(ephemeralSecret), 'window working state retained history-off content');

    // A durable turn in the same window keeps the previous behaviour.
    const durableSecret = 'durable-turn-stays-in-summary';
    const durableMessage = saveChatMessage(historyOffWindow.id, 'user', durableSecret, undefined, 'companion');
    const afterDurable = db.prepare('SELECT summary, working_state FROM chat_windows WHERE id = ?').get(historyOffWindow.id);
    assert.ok(afterDurable.summary.includes(durableSecret), 'durable turn missing from window summary');
    assert.ok(afterDurable.working_state.includes(durableSecret), 'durable turn missing from working state');

    // context_snapshots keep previews of the prompt, so they are chat history under
    // another name. The FK is ON DELETE SET NULL, so the purge has to remove them
    // explicitly or the preview text survives with a null message id.
    const snapshotItem = {
      kind: 'recent', label: 'recent messages', priority: 1, chars: ephemeralSecret.length,
      estimatedTokens: 8, included: true, reason: 'included', preview: ephemeralSecret,
    };
    saveContextSnapshot({
      windowId: historyOffWindow.id, userMessageId: ephemeralMessage.id, mode: 'companion',
      budget: {}, included: [snapshotItem], omitted: [],
      promptMessageCount: 1, promptChars: 1, estimatedPromptTokens: 1,
    });
    saveContextSnapshot({
      windowId: historyOffWindow.id, userMessageId: durableMessage.id, mode: 'companion',
      budget: {}, included: [], omitted: [],
      promptMessageCount: 1, promptChars: 1, estimatedPromptTokens: 1,
    });

    assert.strictEqual(countEphemeralChatMessages(), 1);
    assert.strictEqual(purgeEphemeralChatMessages(), 1);
    assert.strictEqual(countEphemeralChatMessages(), 0);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE content = ?').get(ephemeralSecret).c,
      0,
      'history-off message survived the startup purge',
    );
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE id = ?').get(durableMessage.id).c,
      1,
      'startup purge removed a durable message',
    );
    const survivingSnapshots = db
      .prepare('SELECT included_json FROM context_snapshots WHERE window_id = ?')
      .all(historyOffWindow.id);
    assert.strictEqual(survivingSnapshots.length, 1, 'history-off context snapshot survived the purge');
    assert.ok(
      !survivingSnapshots.some(row => row.included_json.includes(ephemeralSecret)),
      'history-off content survived inside a context snapshot preview',
    );
    assert.strictEqual(
      JSON.parse(db.prepare('SELECT working_state FROM chat_windows WHERE id = ?').get(historyOffWindow.id).working_state).messageCount,
      1,
      'window message count must be rebuilt after the purge',
    );

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
    const requiredMapIds = ['chat', 'long-term-memory', 'settings', 'agent-skills', 'integrations', 'search', 'voice', 'agent-work', 'tools', 'logs', 'temporary-files'];
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

    const projectId = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get().id;
    const windowId = db.prepare(`
      INSERT INTO chat_windows (title, mode, project_id) VALUES ('Privacy export window', 'reason', ?)
    `).run(projectId).lastInsertRowid;
    const chatMessageId = db.prepare(`
      INSERT INTO chat_messages (window_id, role, content, mode) VALUES (?, 'user', 'export this task context', 'reason')
    `).run(windowId).lastInsertRowid;
    db.prepare(`
      INSERT INTO context_snapshots (window_id, user_message_id, mode) VALUES (?, ?, 'reason')
    `).run(windowId, chatMessageId);
    const agentStore = new AgentStore(db);
    let agentTask = agentStore.createTask({
      title: 'Privacy export task',
      goal: 'Prove agent work is exported and cleared.',
      projectId,
      chatWindowId: Number(windowId),
    });
    agentTask = agentStore.transitionTask(agentTask.id, 'ready', agentTask.revision);
    let agentRun = agentStore.createRun({ taskId: agentTask.id });
    agentRun = agentStore.startRun(agentRun.id, agentRun.revision);
    const agentStep = agentStore.appendStep({ runId: agentRun.id, kind: 'verification', title: 'Verify privacy lifecycle' });
    agentStore.addArtifact({ taskId: agentTask.id, runId: agentRun.id, stepId: agentStep.id, kind: 'report', name: 'Privacy evidence' });

    const skillPrivacyData = {
      packages: { 'fixture-hash': { trust: 'approved', enabled: true } },
      invocations: [{ skillName: 'fixture-skill', runId: agentRun.id, stepId: agentStep.id }],
    };
    const integrations = { version: 1, servers: [{ id: 'fixture-mcp', bearerTokenEnv: 'MCP_TOKEN_ENV', approvedFingerprint: 'fixture' }] };
    const exported = exportAllData('json', { agentSkills: skillPrivacyData, integrations });
    assert(fs.existsSync(exported.path), 'data export should exist');
    const exportedJson = JSON.parse(fs.readFileSync(exported.path, 'utf8'));
    assert.strictEqual(exportedJson.staticProtection.status, 'plaintext-sqlite-with-compensating-controls');
    assert(exportedJson.database.messages.some(row => row.content === 'new'));
    assert(exportedJson.database.projects.some(row => row.id === projectId));
    assert(exportedJson.database.chat_windows.some(row => row.id === Number(windowId)));
    assert(exportedJson.database.agent_tasks.some(row => row.id === agentTask.id));
    assert(exportedJson.database.agent_runs.some(row => row.id === agentRun.id));
    assert(exportedJson.database.agent_artifacts.some(row => row.name === 'Privacy evidence'));
    assert.strictEqual(exportedJson.agentSkills.packages['fixture-hash'].trust, 'approved');
    assert.strictEqual(exportedJson.agentSkills.invocations[0].skillName, 'fixture-skill');
    assert.strictEqual(exportedJson.integrations.servers[0].bearerTokenEnv, 'MCP_TOKEN_ENV');
    assert.equal(JSON.stringify(exportedJson.integrations).includes('secret-token-value'), false);
    assert(exportedJson.files.voiceCache.some(file => file.path === freshVoice && file.contentBase64));

    // ATH-INIT-001 / DEBT-007: scheduled work has to outlive the process. Timers
    // cannot be serialised, so the row is the source of truth and startup re-arms.
    const reminderWindow = createChatWindow({ title: 'reminder window' });
    const beforeRestart = [];
    const reminder = new Reminder();
    reminder.setDueHandler(item => beforeRestart.push(item));
    const pendingReminder = reminder.schedule({
      title: '喝水',
      dueAt: new Date(Date.now() + 3_600_000),
      chatWindowId: reminderWindow.id,
    });
    const storedReminder = getScheduledJob(pendingReminder.id);
    assert.ok(storedReminder, 'a reminder must be persisted, not only armed in memory');
    assert.strictEqual(storedReminder.status, 'scheduled');
    assert.strictEqual(storedReminder.chatWindowId, reminderWindow.id);

    // One that came due while Athena was closed.
    createScheduledJob({
      id: 'job-overdue-fixture',
      kind: 'reminder',
      title: '过期提醒',
      dueAt: new Date(Date.now() - 60_000),
      chatWindowId: reminderWindow.id,
    });

    // Simulate a restart: every in-memory timer is gone, the rows are all that remain.
    globalScheduler.shutdown();
    const afterRestart = [];
    const restoredReminder = new Reminder();
    restoredReminder.setDueHandler(item => afterRestart.push(item));
    const restoreResult = restoredReminder.restorePending();
    assert.strictEqual(restoreResult.restored, 2, 'both pending reminders must be re-armed after a restart');
    assert.strictEqual(restoreResult.overdue, 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(afterRestart.length, 1, 'only the reminder that is already due fires on restore');
    assert.strictEqual(afterRestart[0].title, '过期提醒');
    assert.strictEqual(afterRestart[0].overdue, true, 'a reminder missed while closed must be reported as overdue');
    assert.strictEqual(getScheduledJob('job-overdue-fixture').status, 'completed');
    assert.strictEqual(getScheduledJob(pendingReminder.id).status, 'scheduled');
    assert.strictEqual(beforeRestart.length, 0, 'timers from before the restart must not fire');

    // Cancelling settles the row, so a later restore cannot resurrect it.
    assert.strictEqual(restoredReminder.cancel(pendingReminder.id), true);
    assert.strictEqual(getScheduledJob(pendingReminder.id).status, 'cancelled');
    assert.strictEqual(listPendingScheduledJobs().length, 0);

    // Settled jobs expire with the retention window; pending work never does.
    db.prepare("UPDATE scheduled_jobs SET completed_at = '2020-01-01T00:00:00.000Z' WHERE id = 'job-overdue-fixture'").run();
    createScheduledJob({
      id: 'job-future-fixture',
      kind: 'reminder',
      title: '未来提醒',
      dueAt: new Date(Date.now() + 86_400_000),
    });
    const jobRetention = applyDataRetention(new Date('2026-07-15T12:00:00.000Z'));
    assert.strictEqual(jobRetention.scheduledJobsDeleted, 1, 'settled jobs past the retention window must be pruned');
    assert.strictEqual(getScheduledJob('job-overdue-fixture'), null);
    assert.ok(getScheduledJob('job-future-fixture'), 'pending scheduled work must survive retention');

    db.prepare("INSERT INTO profile (category, fact) VALUES ('preference', 'clear me')").run();
    db.prepare("INSERT INTO events (date, summary) VALUES ('2026-07-15', 'clear event')").run();
    db.prepare("INSERT INTO daily_memory_summaries (date, summary) VALUES ('2026-07-15', 'clear daily')").run();
    db.prepare("INSERT INTO procedural_memories (scope, key, instruction) VALUES ('global', 'clear procedure', 'clear instruction')").run();
    db.prepare("INSERT INTO memory_entities (type, name) VALUES ('concept', 'clear entity')").run();
    db.prepare("INSERT INTO memory_facts (subject, predicate, object, summary) VALUES ('clear subject', 'clear predicate', 'clear object', 'clear fact')").run();
    const clearFactId = db.prepare("SELECT id FROM memory_facts WHERE subject = 'clear subject'").get().id;
    db.prepare("INSERT INTO memory_fact_sources (fact_id, source_table, quote) VALUES (?, 'manual', 'clear source')").run(clearFactId);
    db.prepare("INSERT INTO memory_review_queue (kind, title, content, payload_json) VALUES ('fact', 'clear review', 'clear review content', '{}')").run();
    db.prepare("INSERT INTO project_notes (project, title, note) VALUES ('Athena', 'clear project', 'clear note')").run();
    let skillInvocations = 1;
    const cleared = clearAllLocalData({
      clearSkillInvocationHistory: () => {
        const deleted = skillInvocations;
        skillInvocations = 0;
        return deleted;
      },
    });
    assert(cleared.deletedTables.includes('messages'));
    assert.strictEqual(cleared.skillInvocationsDeleted, 1);
    assert.strictEqual(skillInvocations, 0);
    for (const table of ['scheduled_jobs', 'agent_run_events', 'agent_approvals', 'agent_artifacts', 'agent_steps', 'agent_runs', 'agent_tasks', 'context_snapshots', 'chat_messages', 'chat_windows', 'projects', 'messages', 'profile', 'events', 'daily_memory_summaries', 'procedural_memories', 'memory_entities', 'memory_facts', 'memory_fact_sources', 'memory_review_queue', 'project_notes', 'memory_index', 'data_activity_records']) {
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
