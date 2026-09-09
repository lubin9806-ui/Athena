// Every format the composer claims to accept is imported here for real. The
// older suite printed a hand-written "formats=png,jpeg,webp,..." banner without
// ever importing one of them, which is how WebP stayed broken while the tests
// stayed green: Electron's nativeImage decodes only PNG and JPEG, so every WebP
// attachment failed its decode check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-attachment-formats-'));
process.env.ATHENA_DB_DIR = path.join(tempDir, 'database');
process.env.ATHENA_DB_FILENAME = 'attachment-formats-test.db';
process.env.ATHENA_ATTACHMENT_DIR = path.join(tempDir, 'managed-attachments');
process.env.ATHENA_CONFIG_DIR = path.join(tempDir, 'config');

const root = path.resolve(__dirname, '..');
const { createCanvas } = require(path.join(root, 'node_modules', '@napi-rs', 'canvas'));
const JSZip = require(path.join(root, 'node_modules', 'jszip'));
const docx = require(path.join(root, 'node_modules', 'docx'));
const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AttachmentService } = require(path.join(root, 'dist', 'core', 'attachments', 'AttachmentService.js'));
const { extractChatDocument } = require(path.join(root, 'dist', 'core', 'documents', 'ProjectDocumentService.js'));
const { detectChatDocumentMime, isReadableUtf8Text } = require(path.join(root, 'dist', 'core', 'documents', 'DocumentMime.js'));
const { extractSpreadsheetText } = require(path.join(root, 'dist', 'core', 'documents', 'SpreadsheetText.js'));

const SPREADSHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paintedCanvas(width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#3aa0d0';
  context.fillRect(0, 0, width, height);
  return canvas;
}

function makeBmp(width, height) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const buffer = Buffer.alloc(54 + pixelBytes);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(54 + pixelBytes, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  // Rows are padded to a 4-byte boundary, so pixels have to be written row by
  // row — filling straight through the padding produces a BMP the decoder
  // rejects, which says nothing about the code under test.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowBytes + x * 3;
      buffer[offset] = 0x20;
      buffer[offset + 1] = 0x80;
      buffer[offset + 2] = 0xf0;
    }
  }
  return buffer;
}

// A 2x2 GIF87a, the smallest thing that proves the decoder path rather than the
// extension check.
const GIF_2X2 = Buffer.from('R0lGODlhAgACAIAAAP8AAAAA/yH5BAEAAAAALAAAAAACAAIAAAIDRAJZADs=', 'base64');

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const OOXML_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function makeXlsx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file('_rels/.rels', `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_RELS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `${XML_HEADER}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OOXML_RELS}">
<sheets><sheet name="季度数据" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_RELS}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${OOXML_RELS}/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);
  zip.file('xl/sharedStrings.xml', `${XML_HEADER}
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>产品</t></si><si><t>营收</t></si><si><t>台灯</t></si>
</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `${XML_HEADER}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1280</v></c></row>
</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeDocx() {
  const document = new docx.Document({
    sections: [{ children: [new docx.Paragraph({ children: [new docx.TextRun('这是一份用于回归测试的 Word 文档。')] })] }],
  });
  return docx.Packer.toBuffer(document);
}

let exitCode = 0;
(async () => {
  const service = new AttachmentService();
  const project = memory.ensureDefaultProject();
  const chatWindow = memory.createChatWindow({ title: 'Format matrix', projectId: project.id });

  const write = (name, bytes) => {
    const target = path.join(tempDir, name);
    fs.writeFileSync(target, bytes);
    return target;
  };

  // --- images -------------------------------------------------------------
  // png/jpeg/webp keep their own bytes; gif/bmp are stored as the PNG they were
  // converted into, because neither the model path nor the preview reads them.
  const imageCases = [
    { name: 'sample.png', bytes: paintedCanvas(6, 4).toBuffer('image/png'), stored: 'image/png' },
    { name: 'sample.jpg', bytes: paintedCanvas(6, 4).toBuffer('image/jpeg'), stored: 'image/jpeg' },
    { name: 'sample.webp', bytes: paintedCanvas(6, 4).toBuffer('image/webp'), stored: 'image/webp' },
    { name: 'sample.gif', bytes: GIF_2X2, stored: 'image/png' },
    { name: 'sample.bmp', bytes: makeBmp(6, 4), stored: 'image/png' },
  ];
  const importedImages = [];
  for (const testCase of imageCases) {
    let attachment;
    try {
      [attachment] = await service.importImages(chatWindow.id, [write(testCase.name, testCase.bytes)]);
    } catch (error) {
      throw new Error(`${testCase.name} failed to import: ${error.message}`);
    }
    assert.equal(attachment.mime_type, testCase.stored, `${testCase.name} stored as the wrong type`);
    assert.ok(attachment.width > 0 && attachment.height > 0, `${testCase.name} lost its dimensions`);
    assert.equal(attachment.original_name, testCase.name, 'the name a person dragged in must survive conversion');
    assert.ok(
      attachment.preview_data_url && attachment.preview_data_url.startsWith('data:image/png;base64,'),
      `${testCase.name} produced no preview`,
    );
    importedImages.push(attachment.id);
  }
  const modelImages = service.resolveModelImages(chatWindow.id, importedImages);
  assert.equal(modelImages.length, imageCases.length, 'every imported image must reach the model path');
  assert.ok(
    modelImages.every(image => ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)),
    'the model must never be handed a format it cannot read',
  );

  await assert.rejects(
    () => service.importImages(chatWindow.id, [write('fake.png', Buffer.from('this is not an image'))]),
    /无法解码/,
    'a file that only claims to be an image must be refused',
  );

  // --- text, by content rather than by extension ---------------------------
  const textCases = [
    { name: 'notes.txt', body: '纯文本附件。', mime: 'text/plain' },
    { name: 'readme.md', body: '# 标题\n\n正文。', mime: 'text/markdown' },
    { name: 'workflow.json', body: '{"model": "image2_image_turbo", "steps": 12}', mime: 'text/plain' },
    { name: 'rows.csv', body: '产品,营收\n台灯,1280', mime: 'text/plain' },
    { name: 'script.py', body: 'def main():\n    return "ok"', mime: 'text/plain' },
    { name: 'dockerfile', body: 'FROM node:22\nRUN npm ci', mime: 'text/plain' },
  ];
  for (const testCase of textCases) {
    const source = write(testCase.name, Buffer.from(testCase.body, 'utf8'));
    const extracted = await extractChatDocument(source);
    assert.equal(extracted.mimeType, testCase.mime, `${testCase.name} detected as the wrong type`);
    assert.ok(extracted.text.length > 0, `${testCase.name} extracted nothing`);
  }

  assert.equal(isReadableUtf8Text(Buffer.from([0x41, 0x00, 0x42])), false, 'a NUL byte means binary');
  assert.equal(isReadableUtf8Text(Buffer.from([0xff, 0xfe, 0xfd])), false, 'invalid UTF-8 means binary');
  assert.equal(isReadableUtf8Text(Buffer.from('中文 and ascii', 'utf8')), true);
  assert.throws(
    () => detectChatDocumentMime('blob.bin', Buffer.from([0x00, 0x01, 0x02, 0x03])),
    /不是可读取的文本/,
    'binary files must be refused with an explanation, not imported as mojibake',
  );

  // --- office containers ---------------------------------------------------
  const xlsxBytes = await makeXlsx();
  const spreadsheetText = await extractSpreadsheetText(xlsxBytes);
  assert.ok(spreadsheetText.includes('季度数据'), 'the sheet name belongs in the extracted text');
  assert.ok(spreadsheetText.includes('产品\t营收'), 'shared strings must be resolved into their cells');
  assert.ok(spreadsheetText.includes('台灯\t1280'), 'numeric cells must survive next to their labels');

  const xlsxSource = write('quarter.xlsx', xlsxBytes);
  const xlsxExtraction = await extractChatDocument(xlsxSource);
  assert.equal(xlsxExtraction.mimeType, SPREADSHEET_MIME);
  assert.ok(xlsxExtraction.text.includes('台灯'));

  const docxSource = write('memo.docx', await makeDocx());
  const docxExtraction = await extractChatDocument(docxSource);
  assert.equal(docxExtraction.mimeType, WORD_MIME);
  assert.ok(docxExtraction.text.includes('回归测试'));

  assert.throws(
    () => detectChatDocumentMime('mystery.zip', Buffer.from('PK not an office file', 'binary')),
    /不是支持的 Office 文件/,
    'a plain ZIP must not be mistaken for a document',
  );

  // --- the widened storage layer accepts what the readers produced ---------
  const stored = await service.importPreparedFiles(chatWindow.id, [
    { sourcePath: xlsxSource, kind: 'document', mimeType: SPREADSHEET_MIME, contentText: xlsxExtraction.text, sourceSha256: xlsxExtraction.sha256 },
    { sourcePath: path.join(tempDir, 'workflow.json'), kind: 'document', mimeType: 'text/plain', contentText: '{"model": "image2_image_turbo"}' },
  ]);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].mime_type, SPREADSHEET_MIME, 'schema 20 must accept a spreadsheet attachment row');
  assert.equal(stored[0].original_name, 'quarter.xlsx');
  assert.equal(stored[1].original_name, 'workflow.json', 'a .json keeps its name while stored as text/plain');
  assert.equal(stored[1].mime_type, 'text/plain');

  assert.equal(memory.getDatabase().pragma('user_version', { simple: true }), 20, 'the schema must be at version 20');
  assert.deepEqual(memory.getDatabase().pragma('foreign_key_check'), [], 'the rebuilt table must keep its foreign keys');

  console.log([
    'ATHENA_CHAT_ATTACHMENT_FORMATS_OK',
    `images=${imageCases.map(item => path.extname(item.name).slice(1)).join(',')}`,
    `converted=gif,bmp->png`,
    `text=${textCases.map(item => item.name).join(',')}`,
    'office=docx,xlsx',
    'schema=20',
  ].join(' '));
})().catch(error => {
  console.error(error);
  exitCode = 1;
}).finally(() => {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exitCode = exitCode;
  // better-sqlite3 is built against Electron's ABI, so this has to run under
  // Electron — whose main process keeps its loop alive after an async script
  // finishes. Without this the run hangs instead of reporting.
  require('electron').app.exit(exitCode);
});
