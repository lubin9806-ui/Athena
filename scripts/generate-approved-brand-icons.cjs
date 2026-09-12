// Format conversion only: render the frozen approved mark, never regenerate it.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createCanvas, loadImage} = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/brand/companion-prototype/assets/athena-mark.svg'));
const expected = '55aa336147df7d5fbce9fc485ab421988df6108301817e023b800ddfd383e578';
if (createHash('sha256').update(source).digest('hex') !== expected) throw Error('Approved master changed; review before exporting');

async function run() {
  const graphic = await loadImage(Buffer.from(source.toString('utf8').replaceAll('currentColor', '#F5F1E8')));
  const master = createCanvas(1024, 1024), ctx = master.getContext('2d');
  ctx.fillStyle = '#53675F'; ctx.beginPath(); ctx.roundRect(24, 24, 976, 976, 224); ctx.fill();
  ctx.drawImage(graphic, 140, 140, 744, 744);
  fs.writeFileSync(path.join(root, 'resources/athena-brand-icon.png'), master.toBuffer('image/png'));
  const tray = createCanvas(64, 64);
  tray.getContext('2d').drawImage(master, 0, 0, 64, 64);
  fs.writeFileSync(path.join(root, 'resources/athena-tray.png'), tray.toBuffer('image/png'));
  const frames = [16, 24, 32, 48, 64, 128, 256].map(size => {
    const canvas = createCanvas(size, size); canvas.getContext('2d').drawImage(master, 0, 0, size, size);
    return {size, png: canvas.toBuffer('image/png')};
  });
  const header = Buffer.alloc(6 + frames.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({size, png}, i) => {
    const at = 6 + i * 16; header[at] = size === 256 ? 0 : size; header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
  });
  fs.writeFileSync(path.join(root, 'resources/athena-brand.ico'), Buffer.concat([header, ...frames.map(f => f.png)]));
  console.log('ATHENA_APPROVED_ICONS_OK png=1024 tray=64 ico=16,24,32,48,64,128,256 source=unchanged');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
