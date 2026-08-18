const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-diagnostics-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'diagnostics.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_EXPORT_DIR = path.join(scratch, 'exports');
process.env.ATHENA_DIAGNOSTICS_DIR = path.join(scratch, 'diagnostics');
process.env.ATHENA_PROJECT_ROOT = path.join(scratch, 'project-root');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AgentStore } = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));
const { DiagnosticsService } = require(path.join(root, 'dist', 'core', 'diagnostics', 'index.js'));
const { recordCrashDiagnostic, readCrashDiagnosticSummary } = require(path.join(root, 'dist', 'core', 'runtime', 'CrashDiagnostics.js'));

async function run() {
  let exitCode = 0;
  try {
    await app.whenReady();
    fs.mkdirSync(process.env.ATHENA_DB_DIR, { recursive: true });
    fs.mkdirSync(process.env.ATHENA_DIAGNOSTICS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ATHENA_DIAGNOSTICS_DIR, 'keep.txt'), 'must remain', 'utf8');

    const project = memory.ensureDefaultProject();
    const chat = memory.createChatWindow({ title: 'Private chat title', projectId: project.id, mode: 'execute' });
    const store = new AgentStore(memory.getDatabase());
    let task = store.createTask({
      title: 'DO NOT EXPORT PRIVATE TASK',
      goal: 'DO NOT EXPORT PRIVATE GOAL',
      projectId: project.id,
      chatWindowId: chat.id,
    });
    task = store.transitionTask(task.id, 'ready', task.revision);
    store.createRun({ taskId: task.id, provider: 'ollama', model: 'private-model-name' });

    const secret = 'sk-proj-diagnostic-secret-123456789';
    for (let index = 0; index < 1_200; index += 1) {
      recordCrashDiagnostic('uncaught-exception', {
        name: 'FixtureError',
        message: `${secret} ${os.homedir()} ${'x'.repeat(3900)}`,
        stack: `PRIVATE STACK ${index}`,
      });
    }
    const crashBefore = readCrashDiagnosticSummary();
    assert(crashBefore.fileCount >= 2 && crashBefore.fileCount <= 4, 'diagnostic rotation must remain bounded');
    assert(crashBefore.events.every(event => !Object.hasOwn(event.detail, 'message') && !Object.hasOwn(event.detail, 'stack')));

    const service = new DiagnosticsService();
    const health = service.getHealthSnapshot({
      skills: { packages: { privateSkill: { instructions: 'PRIVATE SKILL BODY' } }, invocations: [{ input: 'PRIVATE' }] },
      integrations: { servers: [{ enabled: true, command: 'PRIVATE COMMAND --token secret' }] },
    });
    assert.equal(health.storage.database.quickCheck, 'ok');
    assert.equal(health.extensions.skills.packages, 1);
    assert.equal(health.extensions.integrations.enabled, 1);
    assert.equal(Object.values(health.agent.runsByStatus).reduce((sum, value) => sum + value, 0), 1);

    const result = await service.exportSupportBundle({
      skills: { packages: { privateSkill: { instructions: 'PRIVATE SKILL BODY' } }, invocations: [{ input: 'PRIVATE' }] },
      integrations: { servers: [{ enabled: true, command: 'PRIVATE COMMAND --token secret' }] },
    });
    assert.equal(result.privacy, 'no-chat-content');
    assert(result.bytes > 0 && result.bytes <= 5 * 1024 * 1024);
    const zip = await JSZip.loadAsync(fs.readFileSync(result.path));
    assert.deepEqual(Object.keys(zip.files).sort(), ['README.txt', 'crashes.json', 'health.json', 'manifest.json']);
    const contents = (await Promise.all(Object.values(zip.files).map(file => file.async('string')))).join('\n');
    for (const forbidden of [
      secret, os.homedir(), 'DO NOT EXPORT PRIVATE TASK', 'DO NOT EXPORT PRIVATE GOAL',
      'private-model-name', 'PRIVATE SKILL BODY', 'PRIVATE COMMAND', 'PRIVATE STACK',
    ]) assert.equal(contents.includes(forbidden), false, `support bundle leaked ${forbidden}`);
    assert.match(contents, /no-chat-content/);

    const cleared = service.clear();
    assert(cleared.filesDeleted >= 2 && cleared.filesDeleted <= 4);
    assert.equal(readCrashDiagnosticSummary().fileCount, 0);
    assert.equal(fs.readFileSync(path.join(process.env.ATHENA_DIAGNOSTICS_DIR, 'keep.txt'), 'utf8'), 'must remain');

    const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
    assert.match(renderer, /id="diagnostics-export"/);
    assert.match(renderer, /id="diagnostics-clear"/);
    const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
    assert.match(ipc, /ipcMain\.handle\('diagnostics:exportSupport'.*isTrustedSender/s);
    console.log('ATHENA_DIAGNOSTICS_OK health=local bundle=redacted rotation=bounded clear=diagnostics-only upload=never');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    memory.closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
    process.exit(exitCode);
  }
}

void run();
