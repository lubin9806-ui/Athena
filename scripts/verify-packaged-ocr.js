const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const asar = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const { createCanvas } = require(path.join(asar, 'node_modules', '@napi-rs', 'canvas'));
const { LocalOcrService } = require(path.join(asar, 'dist', 'core', 'ocr', 'index.js'));

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
    service = new LocalOcrService(path.join(os.tmpdir(), `athena-packaged-ocr-${process.pid}`));
    const result = await service.recognize([{ bytes: canvas.toBuffer('image/png'), label: 'packaged.png' }]);
    assert.match(result[0].text, /PACKAGED\s+OCR\s+7319/i);
    console.log('ATHENA_PACKAGED_OCR_OK asar=worker+wasm languages=chi_sim,eng native=canvas');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    try { await service?.shutdown(); } catch {}
    app.quit();
    process.exit(exitCode);
  }
}

void main();
