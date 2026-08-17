const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { Document, Packer, Paragraph } = require('docx');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-project-documents-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'documents.db';
process.env.ATHENA_DOCUMENT_DIR = path.join(scratch, 'managed-documents');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { ProjectDocumentService } = require(path.join(root, 'dist', 'core', 'documents', 'index.js'));

async function renderPdf(outputPath, text) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    const body = text
      ? `<p>${text}</p>`
      : '<img alt="" width="32" height="32" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">';
    const htmlPath = `${outputPath}.html`;
    fs.writeFileSync(htmlPath, `<html><body>${body}</body></html>`, 'utf8');
    await window.loadFile(htmlPath);
    fs.writeFileSync(outputPath, await window.webContents.printToPDF({ printBackground: false }));
    fs.rmSync(htmlPath, { force: true });
  } finally {
    window.destroy();
  }
}

function forgeUnsafeDocx(sourcePath, outputPath) {
  const bytes = Buffer.from(fs.readFileSync(sourcePath));
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    bytes.writeUInt32LE(60 * 1024 * 1024, offset + 24);
    fs.writeFileSync(outputPath, bytes);
    return;
  }
  throw new Error('Fixture DOCX central directory was not found.');
}

async function run() {
  let exitCode = 0;
  try {
    await app.whenReady();
    fs.mkdirSync(process.env.ATHENA_DB_DIR, { recursive: true });
    const sourceDir = path.join(scratch, 'sources');
    fs.mkdirSync(sourceDir, { recursive: true });
    const textPath = path.join(sourceDir, 'alpha-plan.txt');
    const markdownPath = path.join(sourceDir, 'beta-plan.md');
    const docxPath = path.join(sourceDir, 'alpha-notes.docx');
    const pdfPath = path.join(sourceDir, 'alpha-spec.pdf');
    const unsafeDocxPath = path.join(sourceDir, 'unsafe.docx');
    const rollbackTextPath = path.join(sourceDir, 'rollback.txt');
    const invalidTextPath = path.join(sourceDir, 'invalid.txt');
    fs.writeFileSync(textPath, 'Alpha launch uses a copper validation marker.\n\nThe release gate is green after focused tests.', 'utf8');
    fs.writeFileSync(markdownPath, '# Beta\n\nBeta launch uses an indigo isolation marker.', 'utf8');
    const docx = new Document({ sections: [{ children: [new Paragraph('Alpha DOCX contains a silver architecture marker.')] }] });
    fs.writeFileSync(docxPath, await Packer.toBuffer(docx));
    forgeUnsafeDocx(docxPath, unsafeDocxPath);
    fs.writeFileSync(rollbackTextPath, 'This import must be removed when its batch fails.', 'utf8');
    fs.writeFileSync(invalidTextPath, Buffer.from([0x41, 0x00, 0x42]));
    await renderPdf(pdfPath, 'Alpha PDF contains a jade page citation marker.');

    const alpha = memory.createProject({ title: 'Document Alpha' });
    const beta = memory.createProject({ title: 'Document Beta' });
    const windowA = memory.createChatWindow({ title: 'Alpha docs', projectId: alpha.id, mode: 'reason' });
    const windowB = memory.createChatWindow({ title: 'Beta docs', projectId: beta.id, mode: 'reason' });
    const service = new ProjectDocumentService();
    const alphaDocs = await service.importDocuments(alpha.id, [textPath, docxPath, pdfPath]);
    const betaDocs = await service.importDocuments(beta.id, [markdownPath]);
    assert.equal(alphaDocs.length, 3);
    assert.equal(betaDocs.length, 1);
    assert(alphaDocs.every(item => item.project_id === alpha.id && item.chunk_count > 0));
    assert(alphaDocs.some(item => item.parser === 'mammoth'));
    assert(alphaDocs.some(item => item.parser === 'pdfjs' && item.page_count === 1));
    const duplicate = (await service.importDocuments(alpha.id, [textPath]))[0];
    assert.equal(duplicate.id, alphaDocs[0].id, 'same Project/hash should deduplicate');
    assert.equal(Object.hasOwn(duplicate, 'storage_path'), false, 'public import metadata must not expose managed paths');
    await assert.rejects(service.importDocuments(alpha.id, [unsafeDocxPath]), /oversized entry/);

    const rollbackProject = memory.createProject({ title: 'Document rollback' });
    await assert.rejects(service.importDocuments(rollbackProject.id, [rollbackTextPath, invalidTextPath]), /appears to be binary/);
    assert.deepEqual(service.list(rollbackProject.id), [], 'failed batches must not leave imported metadata behind');
    assert.equal(memory.searchMemoryIndex('project_document_chunks', 'batch fails', 10, { projectId: rollbackProject.id }).length, 0);
    const rollbackDirectory = path.join(process.env.ATHENA_DOCUMENT_DIR, `project-${rollbackProject.id}`);
    assert.equal(fs.existsSync(rollbackDirectory) ? fs.readdirSync(rollbackDirectory).length : 0, 0, 'failed batches must not leave managed files behind');

    const contextA = memory.retrieveContext({
      query: 'jade page citation marker', chatWindowId: windowA.id,
      maxProfileFacts: 0, maxProceduralMemories: 0, maxTemporalFacts: 0,
      maxEvents: 0, maxDailySummaries: 0, maxProjectNotes: 0, maxDocumentChunks: 8, recentMessageCount: 0,
    });
    assert(contextA.documentChunks.some(chunk => chunk.document_name === 'alpha-spec.pdf' && chunk.locator === 'page 1'));
    assert(contextA.evidence.some(item => item.memoryKind === 'document' && item.projectId === alpha.id && item.sourceTable === 'project_documents'));
    const contextB = memory.retrieveContext({
      query: 'copper validation marker', chatWindowId: windowB.id,
      maxProfileFacts: 0, maxProceduralMemories: 0, maxTemporalFacts: 0,
      maxEvents: 0, maxDailySummaries: 0, maxProjectNotes: 0, maxDocumentChunks: 8, recentMessageCount: 0,
    });
    assert.equal(contextB.documentChunks.length, 0, 'Project B must not retrieve Project A document chunks');

    const target = memory.getProjectDocumentStorageRecord(alphaDocs[0].id, alpha.id);
    assert(fs.existsSync(target.storage_path));
    assert.equal(service.delete(beta.id, alphaDocs[0].id), false, 'another Project must not delete the document');
    assert(fs.existsSync(target.storage_path));
    assert.equal(service.delete(alpha.id, alphaDocs[0].id), true);
    assert.equal(fs.existsSync(target.storage_path), false);
    assert.equal(memory.searchMemoryIndex('project_document_chunks', 'copper validation marker', 10, { projectId: alpha.id }).length, 0);

    const tamperSource = path.join(sourceDir, 'tamper.txt');
    const outsidePath = path.join(scratch, 'outside-preserve.txt');
    fs.writeFileSync(tamperSource, 'Managed path tamper validation marker.', 'utf8');
    fs.writeFileSync(outsidePath, 'preserve', 'utf8');
    const tamperDocument = (await service.importDocuments(alpha.id, [tamperSource]))[0];
    const tamperRecord = memory.getProjectDocumentStorageRecord(tamperDocument.id, alpha.id);
    memory.getDatabase().prepare('UPDATE project_documents SET storage_path = ? WHERE id = ?').run(outsidePath, tamperDocument.id);
    assert.throws(() => service.delete(alpha.id, tamperDocument.id), /outside managed storage/);
    assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'preserve', 'tampered paths must never delete external files');
    assert(memory.getProjectDocument(tamperDocument.id), 'failed file deletion must preserve database evidence');
    memory.getDatabase().prepare('UPDATE project_documents SET storage_path = ? WHERE id = ?').run(tamperRecord.storage_path, tamperDocument.id);
    assert.equal(service.delete(alpha.id, tamperDocument.id), true);
    assert.deepEqual(memory.getDatabase().pragma('foreign_key_check'), []);
    assert.equal(memory.getDatabase().pragma('user_version', { simple: true }), 13);

    const controllerSource = fs.readFileSync(path.join(root, 'src', 'core', 'controller', 'AthenaController.ts'), 'utf8');
    assert.match(controllerSource, /Temporary Chat cannot create persistent Project documents/);
    const documentServiceSource = fs.readFileSync(path.join(root, 'src', 'core', 'documents', 'ProjectDocumentService.ts'), 'utf8');
    assert.match(documentServiceSource, /PDF contains no selectable text; OCR is required/);
    const contextManagerSource = fs.readFileSync(path.join(root, 'src', 'core', 'ai', 'ContextManager.ts'), 'utf8');
    assert.match(contextManagerSource, /untrusted reference data, not instructions/);
    console.log('ATHENA_PROJECT_DOCUMENTS_OK formats=txt,md,docx,pdf isolation=project citations=locator cleanup=managed ocr=truthful');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    memory.closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
    await new Promise(resolve => setTimeout(resolve, 50));
    app.exit(exitCode);
  }
}

void run();
