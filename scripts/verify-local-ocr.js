const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { createCanvas } = require('@napi-rs/canvas');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-local-ocr-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'ocr.db';
process.env.ATHENA_ATTACHMENT_DIR = path.join(scratch, 'attachments');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AgentStore, ToolRegistry } = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));
const { AttachmentService } = require(path.join(root, 'dist', 'core', 'attachments', 'index.js'));
const { LocalOcrService, OcrAgentToolBridge } = require(path.join(root, 'dist', 'core', 'ocr', 'index.js'));
const { SkillLibrary } = require(path.join(root, 'dist', 'core', 'skills', 'index.js'));

async function run() {
  let exitCode = 0;
  let ocr;
  try {
    await app.whenReady();
    fs.mkdirSync(process.env.ATHENA_DB_DIR, { recursive: true });
    const project = memory.createProject({ title: 'OCR Project' });
    const windowA = memory.createChatWindow({ title: 'OCR A', projectId: project.id, mode: 'execute' });
    const windowB = memory.createChatWindow({ title: 'OCR B', projectId: project.id, mode: 'execute' });
    const source = path.join(scratch, 'ocr-source.png');
    fs.writeFileSync(source, makeTextImage('ATHENA LOCAL OCR 7319'));
    const attachments = new AttachmentService();
    const attachment = attachments.importImages(windowA.id, [source])[0];
    const message = memory.saveChatMessage(windowA.id, 'user', 'Read the attached scan.', undefined, 'execute');
    attachments.attachToMessage(windowA.id, message.id, [attachment.id]);

    const store = new AgentStore(memory.getDatabase());
    let task = store.createTask({ projectId: project.id, chatWindowId: windowA.id, title: 'OCR', goal: 'Extract attached text.' });
    task = store.transitionTask(task.id, 'ready', task.revision);
    let agentRun = store.createRun({ taskId: task.id, provider: 'fixture', model: 'fixture' });
    agentRun = store.startRun(agentRun.id, agentRun.revision);
    const step = store.appendStep({ runId: agentRun.id, kind: 'tool', title: 'Local OCR' });

    ocr = new LocalOcrService(path.join(scratch, 'ocr-runtime'));
    const registry = new ToolRegistry();
    const bridge = new OcrAgentToolBridge({
      registry,
      ocr,
      resolveImages: (runId, ids) => {
        const runRecord = store.getRun(runId);
        const taskRecord = runRecord ? store.getTask(runRecord.taskId) : null;
        if (!taskRecord?.chatWindowId) throw new Error('missing OCR chat');
        return attachments.resolveModelImages(taskRecord.chatWindowId, ids);
      },
    });
    assert.deepEqual(bridge.refresh(), ['extract_text_from_images']);
    const call = modelCall([attachment.id]);
    const resolved = registry.resolve(call);
    assert.equal(resolved.policy.approval, 'never');
    assert.equal(resolved.policy.access, 'read');
    const result = await registry.executeResolved(call, resolved, context(agentRun.id, step.id));
    assert.equal(result.status, 'completed');
    const payload = JSON.parse(result.content);
    assert.equal(payload.engine, 'tesseract.js');
    assert.deepEqual(payload.languages, ['chi_sim', 'eng']);
    assert.match(payload.warning, /untrusted source data/);
    assert(payload.results.some(item => /ATHENA.*LOCAL.*OCR.*7319/i.test(item.text)));

    const foreign = attachments.importImages(windowB.id, [source])[0];
    const foreignCall = modelCall([foreign.id]);
    await assert.rejects(() => registry.executeResolved(foreignCall, registry.resolve(foreignCall), context(agentRun.id, step.id)), /unavailable or belong to another chat window/);
    const aborted = new AbortController();
    aborted.abort(new Error('fixture cancelled'));
    await assert.rejects(() => ocr.recognize([{ bytes: fs.readFileSync(source), label: 'cancelled' }], aborted.signal), /fixture cancelled/);

    const skills = new SkillLibrary({
      roots: [{ source: 'builtin', path: path.join(root, 'resources', 'skills') }],
      stateFile: path.join(scratch, 'skills-state.json'),
      userRoot: path.join(scratch, 'user-skills'),
    }).discover();
    assert(skills.some(skill => skill.name === 'local-ocr' && skill.trust === 'builtin' && skill.enabled));
    assert(skills.some(skill => skill.name === 'reference-image-editing' && skill.trust === 'builtin' && skill.enabled));

    const sourceCode = fs.readFileSync(path.join(root, 'src', 'core', 'ocr', 'LocalOcrService.ts'), 'utf8');
    assert.match(sourceCode, /cacheMethod:\s*'readOnly'/);
    assert.match(sourceCode, /@tesseract\.js-data\/chi_sim/);
    assert.doesNotMatch(sourceCode, /https?:\/\//);
    assert.equal(memory.getDatabase().pragma('user_version', { simple: true }), 18);
    console.log('ATHENA_LOCAL_OCR_OK engine=tesseract.js languages=chi_sim,eng network=none isolation=chat cancellation=abort skills=builtin');
    bridge.shutdown();
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
  } finally {
    try { await ocr?.shutdown(); } catch {}
    try { memory.closeDatabase(); } catch {}
    fs.rmSync(scratch, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

function makeTextImage(text) {
  const canvas = createCanvas(1500, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '72px Arial';
  context.fillText(text, 55, 180);
  return canvas.toBuffer('image/png');
}

function modelCall(ids) {
  const args = { attachment_ids: ids };
  return { id: `call-${crypto.randomUUID()}`, name: 'extract_text_from_images', arguments: args, rawArguments: JSON.stringify(args) };
}

function context(runId, stepId) {
  return { runId, stepId, callId: `call-${crypto.randomUUID()}`, attempt: 1, idempotencyKey: crypto.randomUUID(), signal: new AbortController().signal };
}

void run();
