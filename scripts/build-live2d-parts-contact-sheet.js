const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function main() {
  const inventoryPath = path.resolve(process.argv[2] || 'assets/avatar/athena-live2d-default/source/parts/parts-inventory-v1.json');
  const root = path.dirname(inventoryPath);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const columns = 5;
  const cellWidth = 300;
  const cellHeight = 250;
  const rows = Math.ceil(inventory.parts.length / columns);
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#dfe4e8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '15px Segoe UI';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < inventory.parts.length; index += 1) {
    const part = inventory.parts[index];
    const image = await loadImage(path.join(root, part.file));
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    context.fillStyle = '#f7f8f9';
    context.fillRect(left + 4, top + 4, cellWidth - 8, cellHeight - 8);
    const maxWidth = cellWidth - 30;
    const maxHeight = cellHeight - 58;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1.5);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, left + (cellWidth - width) / 2, top + 12 + (maxHeight - height) / 2, width, height);
    context.fillStyle = '#20262d';
    context.fillText(part.name, left + cellWidth / 2, top + cellHeight - 24, cellWidth - 22);
  }

  const output = path.join(root, 'parts-contact-sheet-v1.png');
  fs.writeFileSync(output, canvas.toBuffer('image/png'));
  console.log(`ATHENA_LIVE2D_CONTACT_SHEET_OK output=${output} width=${canvas.width} height=${canvas.height}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
