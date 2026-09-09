// Covers what a drop turns into before any of it reaches the attachment store:
// folder expansion, the five-file ceiling, staging files for dropped text, and
// the rules a downloaded web image has to pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  downloadDroppedImage,
  expandDroppedPaths,
  sniffImageExtension,
  writeDroppedText,
} = require(path.join(root, 'dist', 'core', 'attachments', 'DroppedContent.js'));
// The drop zone module only touches the DOM once constructed, so its pure rules
// can be checked without a renderer.
const { shouldStoreTextAsAttachment } = require(path.join(root, 'dist', 'renderer', 'ui', 'DropZone.js'));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-drop-'));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function write(relative, contents) {
  const target = path.join(tempDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function startServer(routes) {
  const server = http.createServer((request, response) => {
    const route = routes[request.url];
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(route.status || 200, route.headers || {});
    response.end(route.body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let exitCode = 0;
(async () => {
  // --- single files, folders, and the ceiling ------------------------------
  const loose = write('loose/notes.txt', 'hello');
  const folderFiles = ['a.png', 'b.txt', 'c.xlsx', 'd.exe', 'e.zip', 'f.md']
    .map(name => write(path.join('folder', name), name === 'a.png' ? PNG_1X1 : Buffer.from(name)));
  fs.mkdirSync(path.join(tempDir, 'folder', 'nested'), { recursive: true });

  const single = expandDroppedPaths([loose], 5);
  assert.deepEqual(single.files, [loose]);
  assert.equal(single.overflow, false);

  const folder = expandDroppedPaths([path.join(tempDir, 'folder')], 5);
  assert.deepEqual(
    folder.files.map(file => path.basename(file)),
    ['a.png', 'b.txt', 'c.xlsx', 'f.md'],
    'a dropped folder contributes its supported files in name order',
  );
  assert.ok(folder.skipped.includes('d.exe') && folder.skipped.includes('e.zip'), 'skipped files must be named, not silently dropped');
  assert.equal(folder.overflow, false);

  const crowded = expandDroppedPaths([path.join(tempDir, 'folder'), loose], 2);
  assert.equal(crowded.files.length, 2, 'the per-message ceiling holds');
  assert.equal(crowded.overflow, true, 'exceeding the ceiling must be reported, not thrown away quietly');

  const missing = expandDroppedPaths([path.join(tempDir, 'does-not-exist.txt')], 5);
  assert.deepEqual(missing.files, []);
  assert.deepEqual(missing.skipped, ['does-not-exist.txt']);

  // --- dropped text ---------------------------------------------------------
  const staging = path.join(tempDir, 'staging');
  const textFile = writeDroppedText('从网页拖进来的一段文字。', staging);
  assert.equal(fs.readFileSync(textFile, 'utf8'), '从网页拖进来的一段文字。');
  assert.equal(path.extname(textFile), '.txt');
  assert.notEqual(writeDroppedText('second', staging), textFile, 'two drops must not collide on one filename');

  assert.equal(shouldStoreTextAsAttachment('短短一句话'), false, 'a sentence belongs in the composer');
  assert.equal(shouldStoreTextAsAttachment('字'.repeat(1_999)), false);
  assert.equal(shouldStoreTextAsAttachment('字'.repeat(2_000)), true, 'a whole article belongs in a file');

  // --- image sniffing -------------------------------------------------------
  assert.equal(sniffImageExtension(PNG_1X1), 'png');
  assert.equal(sniffImageExtension(Buffer.from('GIF89a and more')), 'gif');
  assert.equal(sniffImageExtension(Buffer.from('BM padding here')), 'bmp');
  assert.equal(sniffImageExtension(Buffer.from('<!doctype html><html>')), null, 'an HTML error page is not an image');

  // --- downloads ------------------------------------------------------------
  const server = await startServer({
    '/cat.png': { body: PNG_1X1, headers: { 'content-type': 'image/png' } },
    // A server that lies about the type still has to produce image bytes.
    '/lying.png': { body: Buffer.from('<!doctype html><html>nope</html>'), headers: { 'content-type': 'image/png' } },
    '/missing.png': { status: 404, body: '' },
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const downloaded = await downloadDroppedImage(`${origin}/cat.png`, staging);
    assert.ok(fs.readFileSync(downloaded).equals(PNG_1X1), 'the downloaded bytes must be what the server sent');
    assert.equal(path.extname(downloaded), '.png');

    await assert.rejects(() => downloadDroppedImage(`${origin}/lying.png`, staging), /不是支持的图片格式/);
    await assert.rejects(() => downloadDroppedImage(`${origin}/missing.png`, staging), /HTTP 404/);
    await assert.rejects(() => downloadDroppedImage('file:///etc/passwd', staging), /只支持 http/);
    await assert.rejects(() => downloadDroppedImage('ftp://example.com/x.png', staging), /只支持 http/);
  } finally {
    server.close();
  }

  console.log('ATHENA_CHAT_DROP_OK folders=expanded ceiling=reported text=staged download=sniffed schemes=http,https');
})().catch(error => {
  console.error(error);
  exitCode = 1;
}).finally(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exitCode = exitCode;
});
