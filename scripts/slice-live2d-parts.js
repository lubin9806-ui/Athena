const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function main() {
  const layoutPath = path.resolve(process.argv[2] || 'assets/avatar/athena-live2d-default/source/parts/parts-layout-v1.json');
  const layoutRoot = path.dirname(layoutPath);
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const outputRoot = path.join(layoutRoot, layout.outputDirectory);
  fs.mkdirSync(outputRoot, { recursive: true });
  const inventory = [];

  for (const atlas of layout.atlases) {
    const atlasPath = path.join(layoutRoot, atlas.file);
    const image = await loadImage(atlasPath);
    const sourceCanvas = createCanvas(image.width, image.height);
    const sourceContext = sourceCanvas.getContext('2d');
    sourceContext.drawImage(image, 0, 0);

    for (const part of atlas.parts) {
      const [x, y, width, height] = part.rect;
      assertRect(part.name, x, y, width, height, image.width, image.height);
      const crop = sourceContext.getImageData(x, y, width, height);
      const bounds = alphaBounds(crop.data, width, height);
      if (!bounds || bounds.pixelCount < 40) throw new Error(`Part is empty or too small: ${part.name}`);
      const padding = 4;
      const cropX = Math.max(0, bounds.minX - padding);
      const cropY = Math.max(0, bounds.minY - padding);
      const cropMaxX = Math.min(width - 1, bounds.maxX + padding);
      const cropMaxY = Math.min(height - 1, bounds.maxY + padding);
      const outputWidth = cropMaxX - cropX + 1;
      const outputHeight = cropMaxY - cropY + 1;
      const outputCanvas = createCanvas(outputWidth, outputHeight);
      const outputContext = outputCanvas.getContext('2d');
      outputContext.drawImage(sourceCanvas, x + cropX, y + cropY, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);
      const fileName = `${part.name}.png`;
      fs.writeFileSync(path.join(outputRoot, fileName), outputCanvas.toBuffer('image/png'));
      inventory.push({
        name: part.name,
        file: `${layout.outputDirectory}/${fileName}`,
        sourceAtlas: atlas.file,
        sourceRect: part.rect,
        sourceOffset: [x + cropX, y + cropY],
        width: outputWidth,
        height: outputHeight,
        pixelCount: bounds.pixelCount,
      });
    }
  }

  const inventoryPath = path.join(layoutRoot, 'parts-inventory-v1.json');
  fs.writeFileSync(inventoryPath, `${JSON.stringify({ version: 1, count: inventory.length, parts: inventory }, null, 2)}\n`);
  console.log(`ATHENA_LIVE2D_PARTS_OK count=${inventory.length} output=${outputRoot}`);
}

function alphaBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixelCount += 1;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, pixelCount };
}

function assertRect(name, x, y, width, height, atlasWidth, atlasHeight) {
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > atlasWidth || y + height > atlasHeight) {
    throw new Error(`Invalid crop rectangle for ${name}: ${[x, y, width, height].join(',')}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
