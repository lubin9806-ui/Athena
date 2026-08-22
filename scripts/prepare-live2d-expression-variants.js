const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, ImageData } = require('@napi-rs/canvas');
const { initializeCanvas, writePsdBuffer, readPsd } = require('ag-psd');

initializeCanvas(createCanvas, (width, height) => new ImageData(width, height));

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'source');
const MASTER_PATH = path.join(SOURCE_ROOT, 'athena-live2d-default-front-v2-alpha.png');
const OUTPUT_ROOT = path.join(SOURCE_ROOT, 'expression-variants');
const MASTER_DARK_BOUNDS = { left: 220, top: 57, right: 704, bottom: 1604 };

const VARIANTS = [
  {
    id: 'blink',
    raw: 'raw/blink-generated.png',
    output: 'ATH_EXPRESSION_BLINK_PATCH.png',
    patch: { centerX: 450, centerY: 190, radiusX: 104, radiusY: 76, featherStart: 0.68 },
  },
  {
    id: 'speak',
    raw: 'raw/speak-generated.png',
    output: 'ATH_EXPRESSION_SPEAK_PATCH.png',
    patch: { centerX: 450, centerY: 239, radiusX: 63, radiusY: 50, featherStart: 0.62 },
  },
  {
    id: 'happy',
    raw: 'raw/happy-generated.png',
    output: 'ATH_EXPRESSION_HAPPY_PATCH.png',
    patch: { centerX: 450, centerY: 209, radiusX: 102, radiusY: 104, featherStart: 0.7 },
  },
];

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const master = await loadImage(MASTER_PATH);
  const masterPixels = pixelsFor(master);
  const results = [];

  for (const variant of VARIANTS) {
    const rawPath = path.join(OUTPUT_ROOT, variant.raw);
    const raw = await loadImage(rawPath);
    const rawBounds = darkBounds(raw);
    const transform = alignBounds(rawBounds, MASTER_DARK_BOUNDS);
    const aligned = createCanvas(master.width, master.height);
    const alignedContext = aligned.getContext('2d');
    alignedContext.imageSmoothingEnabled = true;
    alignedContext.imageSmoothingQuality = 'high';
    alignedContext.setTransform(transform.scaleX, 0, 0, transform.scaleY, transform.translateX, transform.translateY);
    alignedContext.drawImage(raw, 0, 0);
    alignedContext.resetTransform();

    const patchCanvas = createCanvas(master.width, master.height);
    const patchContext = patchCanvas.getContext('2d');
    patchContext.drawImage(aligned, 0, 0);
    const patchPixels = patchContext.getImageData(0, 0, master.width, master.height);
    applyFeatheredAlpha(patchPixels.data, masterPixels.data, master.width, master.height, variant.patch);
    patchContext.putImageData(patchPixels, 0, 0);

    const outputPath = path.join(OUTPUT_ROOT, variant.output);
    fs.writeFileSync(outputPath, patchCanvas.toBuffer('image/png'));
    results.push({
      id: variant.id,
      raw: variant.raw.replaceAll('\\', '/'),
      output: variant.output,
      width: master.width,
      height: master.height,
      rawBounds,
      transform,
      patch: variant.patch,
    });
  }

  const metadata = {
    version: 1,
    master: path.relative(PACKAGE_ROOT, MASTER_PATH).replaceAll('\\', '/'),
    purpose: 'Aligned feathered expression patches for Cubism opacity switching.',
    variants: results,
  };
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'expression-variants-v1.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeExpressionPsd(master, results);
  await writeContactSheet(master, results);
  console.log(`ATHENA_LIVE2D_EXPRESSION_VARIANTS_OK variants=${results.length} size=${master.width}x${master.height}`);
}

async function writeExpressionPsd(master, results) {
  const blank = createCanvas(master.width, master.height).getContext('2d').getImageData(0, 0, master.width, master.height);
  const layers = [];
  for (const result of results) {
    const image = await loadImage(path.join(OUTPUT_ROOT, result.output));
    layers.push({
      name: result.output.replace('.png', ''),
      left: 0,
      top: 0,
      imageData: pixelsFor(image),
    });
  }
  const psd = {
    width: master.width,
    height: master.height,
    imageData: blank,
    children: [{
      name: 'ExpressionVariants',
      hidden: true,
      opened: true,
      children: layers,
    }],
  };
  const outputPath = path.join(OUTPUT_ROOT, 'athena-live2d-expression-variants-v1.psd');
  fs.writeFileSync(outputPath, writePsdBuffer(psd, { generateThumbnail: true }));
  const verified = readPsd(fs.readFileSync(outputPath), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const names = (verified.children?.[0]?.children || []).map(layer => layer.name);
  if (names.length !== results.length || results.some(result => !names.includes(result.output.replace('.png', '')))) {
    throw new Error('Expression PSD layer verification failed.');
  }
}

function pixelsFor(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

function darkBounds(image) {
  const pixels = pixelsFor(image).data;
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      if (pixels[index + 3] <= 32 || luminance >= 225) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Unable to detect generated character bounds.');
  return { left, top, right, bottom };
}

function alignBounds(source, target) {
  const sourceWidth = source.right - source.left;
  const sourceHeight = source.bottom - source.top;
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  return {
    scaleX,
    scaleY,
    translateX: target.left - source.left * scaleX,
    translateY: target.top - source.top * scaleY,
  };
}

function applyFeatheredAlpha(patch, master, width, height, mask) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dx = (x - mask.centerX) / mask.radiusX;
      const dy = (y - mask.centerY) / mask.radiusY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const feather = clamp01((1 - distance) / (1 - mask.featherStart));
      const smooth = feather * feather * (3 - 2 * feather);
      patch[index + 3] = Math.round(master[index + 3] * smooth);
    }
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

async function writeContactSheet(master, results) {
  const crop = { left: 330, top: 70, width: 240, height: 285 };
  const tileWidth = 300;
  const tileHeight = 390;
  const sheet = createCanvas(tileWidth * (results.length + 1), tileHeight);
  const context = sheet.getContext('2d');
  context.fillStyle = '#eef1f4';
  context.fillRect(0, 0, sheet.width, sheet.height);
  drawPreviewTile(context, master, null, 0, 'neutral', crop, tileWidth, tileHeight);
  for (let index = 0; index < results.length; index += 1) {
    const patch = await loadImage(path.join(OUTPUT_ROOT, results[index].output));
    drawPreviewTile(context, master, patch, index + 1, results[index].id, crop, tileWidth, tileHeight);
  }
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'expression-variants-contact-sheet-v1.png'), sheet.toBuffer('image/png'));
}

function drawPreviewTile(context, master, patch, index, label, crop, tileWidth, tileHeight) {
  const x = index * tileWidth;
  context.fillStyle = '#ffffff';
  context.fillRect(x + 12, 12, tileWidth - 24, tileHeight - 24);
  context.drawImage(master, crop.left, crop.top, crop.width, crop.height, x + 30, 35, 240, 285);
  if (patch) context.drawImage(patch, crop.left, crop.top, crop.width, crop.height, x + 30, 35, 240, 285);
  context.fillStyle = '#17202b';
  context.font = '600 20px Arial';
  context.textAlign = 'center';
  context.fillText(label, x + tileWidth / 2, 355);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
