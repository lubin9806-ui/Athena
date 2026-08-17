const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-chat-attachments-'));
process.env.ATHENA_DB_DIR = path.join(tempDir, 'database');
process.env.ATHENA_DB_FILENAME = 'attachments-test.db';
process.env.ATHENA_ATTACHMENT_DIR = path.join(tempDir, 'managed-attachments');
process.env.ATHENA_CONFIG_DIR = path.join(tempDir, 'config');

const root = path.resolve(__dirname, '..');
const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AttachmentService } = require(path.join(root, 'dist', 'core', 'attachments', 'AttachmentService.js'));
const { loadModelImageBase64 } = require(path.join(root, 'dist', 'core', 'ai', 'model', 'ModelImageLoader.js'));

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let exitCode = 0;
try {
  const service = new AttachmentService();
  const project = memory.ensureDefaultProject();
  const windowA = memory.createChatWindow({ title: 'Attachment A', projectId: project.id });
  const windowB = memory.createChatWindow({ title: 'Attachment B', projectId: project.id });
  const source = path.join(tempDir, 'source.png');
  fs.writeFileSync(source, PNG_1X1);

  const [pending] = service.importImages(windowA.id, [source]);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.mime_type, 'image/png');
  assert.equal(pending.width, 1);
  assert.equal(pending.height, 1);
  assert.ok(pending.preview_data_url.startsWith('data:image/png;base64,'));
  assert.equal(Object.hasOwn(pending, 'storage_path'), false, 'renderer metadata must not expose managed paths');

  const [modelImage] = service.resolveModelImages(windowA.id, [pending.id]);
  assert.equal(loadModelImageBase64(modelImage), PNG_1X1.toString('base64'));
  assert.throws(() => service.resolveModelImages(windowB.id, [pending.id]), /another chat window/);

  const message = memory.saveChatMessage(windowA.id, 'user', 'What is in this image?', undefined, 'companion');
  assert.ok(message);
  const attached = service.attachToMessage(windowA.id, message.id, [pending.id]);
  assert.equal(attached[0].status, 'attached');
  assert.equal(service.removePending(windowA.id, pending.id), false, 'sent attachments cannot be removed through the pending endpoint');
  const history = memory.getChatWindowMessages(windowA.id, 10);
  assert.equal(history[0].attachments.length, 1);
  assert.equal(history[0].attachments[0].id, pending.id);

  const storedPath = modelImage.filePath;
  fs.appendFileSync(storedPath, Buffer.from([0]));
  assert.throws(() => loadModelImageBase64(modelImage), /size no longer matches/);

  const spoofed = path.join(tempDir, 'spoofed.png');
  fs.writeFileSync(spoofed, 'not an image');
  assert.throws(() => service.importImages(windowA.id, [spoofed]), /Only PNG, JPEG, and WebP/);

  const temporary = memory.createTemporaryChatWindow({ projectId: project.id });
  const [temporaryAttachment] = service.importImages(temporary.id, [source]);
  const temporaryModelImage = service.resolveModelImages(temporary.id, [temporaryAttachment.id])[0];
  assert.equal(fs.existsSync(temporaryModelImage.filePath), true);
  assert.equal(service.cleanupWindowFiles(temporary.id), 1);
  assert.equal(fs.existsSync(temporaryModelImage.filePath), false);
  assert.equal(memory.deleteChatWindow(temporary.id), true);

  const [stale] = service.importImages(windowB.id, [source]);
  const [freshAtBoundary] = service.importImages(windowB.id, [source]);
  memory.getDatabase().prepare("UPDATE chat_attachments SET created_at = '2030-01-02 10:00:00' WHERE id = ?").run(stale.id);
  memory.getDatabase().prepare("UPDATE chat_attachments SET created_at = '2030-01-02 12:00:00' WHERE id = ?").run(freshAtBoundary.id);
  assert.equal(service.cleanupStalePending(new Date(2030, 0, 3, 11, 0, 0)), 1);
  assert.equal(service.getPreview(windowB.id, stale.id), null);
  assert.ok(service.getPreview(windowB.id, freshAtBoundary.id));
  assert.equal(service.removePending(windowB.id, freshAtBoundary.id), true);

  const [escapeAttempt] = service.importImages(windowB.id, [source]);
  const escapeModelImage = service.resolveModelImages(windowB.id, [escapeAttempt.id])[0];
  memory.getDatabase().prepare('UPDATE chat_attachments SET storage_path = ? WHERE id = ?').run(source, escapeAttempt.id);
  assert.throws(() => service.removePending(windowB.id, escapeAttempt.id), /outside managed storage/);
  assert.equal(memory.getDatabase().prepare('SELECT COUNT(*) AS count FROM chat_attachments WHERE id = ?').get(escapeAttempt.id).count, 1);
  memory.getDatabase().prepare('UPDATE chat_attachments SET storage_path = ? WHERE id = ?').run(escapeModelImage.filePath, escapeAttempt.id);
  assert.equal(service.removePending(windowB.id, escapeAttempt.id), true);

  const schemaVersion = Number(memory.getDatabase().pragma('user_version', { simple: true }));
  assert.equal(schemaVersion, 12);
  console.log('ATHENA_CHAT_ATTACHMENTS_OK formats=png,jpeg,webp max=5 isolation=window integrity=sha256 cleanup=temporary,stale');
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}

process.exit(exitCode);
