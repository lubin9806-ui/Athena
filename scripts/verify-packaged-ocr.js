const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const asar = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-packaged-documents-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DOCUMENT_DIR = path.join(scratch, 'managed-documents');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const { createCanvas } = require(path.join(asar, 'node_modules', '@napi-rs', 'canvas'));
const { LocalOcrService } = require(path.join(asar, 'dist', 'core', 'ocr', 'index.js'));
const { ProjectDocumentService, extractChatDocument } = require(path.join(asar, 'dist', 'core', 'documents', 'index.js'));
const memory = require(path.join(asar, 'dist', 'memory', 'index.js'));

app.on('window-all-closed', () => {});

async function renderPdf(outputPath, body) {
  const htmlPath = path.join(scratch, `${path.basename(outputPath, '.pdf')}.html`);
  fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>body{font:32px Arial;padding:48px}img{max-width:100%}</style>${body}`, 'utf8');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await window.loadURL(pathToFileURL(htmlPath).href);
    fs.writeFileSync(outputPath, await window.webContents.printToPDF({ printBackground: true }));
  } finally {
    window.destroy();
  }
}

async function main() {
  let service;
  let exitCode = 0;
  try {
    await app.whenReady();
    const canvas = createCanvas(1200, 320);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '72px Arial';
    context.fillText('PACKAGED OCR 7319', 55, 190);
    const scanImage = canvas.toBuffer('image/png');
    service = new LocalOcrService(path.join(scratch, 'ocr'));
    const result = await service.recognize([{ bytes: scanImage, label: 'packaged.png' }]);
    assert.match(result[0].text, /PACKAGED\s+OCR\s+7319/i);

    const textPdf = path.join(scratch, 'packaged-text.pdf');
    await renderPdf(textPdf, '<p>PACKAGED PDF TEXT 4826</p>');
    const chatPdf = await extractChatDocument(textPdf);
    assert.match(chatPdf.text, /PACKAGED PDF TEXT 4826/i, 'packaged chat PDF extraction must preserve selectable text');

    const project = memory.createProject({ title: 'Packaged PDF verification' });
    const documents = new ProjectDocumentService({ ocr: service });
    const imported = await documents.importFiles(project.id, [textPdf]);
    assert.match(imported[0].text, /PACKAGED PDF TEXT 4826/i, 'packaged project PDF import must preserve selectable text');

    const scannedPdf = path.join(scratch, 'packaged-scan.pdf');
    await renderPdf(scannedPdf, `<img src="data:image/png;base64,${scanImage.toString('base64')}">`);
    const scanned = await documents.importScannedPdfs(project.id, [scannedPdf]);
    assert.match(scanned[0].text, /PACKAGED\s+OCR\s+7319/i, 'packaged scanned PDF import must use local OCR');

    console.log('ATHENA_PACKAGED_OCR_OK asar=worker+wasm languages=chi_sim,eng native=canvas chatPdf=ok projectPdf=ok scannedPdfOcr=ok');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    try { await service?.shutdown(); } catch {}
    try { memory.closeDatabase(); } catch {}
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
    process.exit(exitCode);
  }
}

void main();
