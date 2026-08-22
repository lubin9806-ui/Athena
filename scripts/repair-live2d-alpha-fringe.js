const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const TEXTURES = [
  'assets/avatar/athena-live2d-default/model/athena-live2d-default-sdk5.4096/texture_00.png',
  'assets/avatar/athena-live2d-default/model/athena-live2d-default.4096/texture_00.png',
  'assets/avatar/athena-live2d-default/source/athena-live2d-default-front-v2-alpha.png',
];

main().catch(error => {
  console.error('ATHENA_LIVE2D_ALPHA_REPAIR_FAILED', error);
  process.exitCode = 1;
});

async function main() {
  const results = [];
  for (const relativePath of TEXTURES) {
    const filePath = path.join(ROOT, relativePath);
    const result = await repairTexture(filePath);
    results.push(`${relativePath}:${result.changedPixels}`);
  }
  console.log(`ATHENA_LIVE2D_ALPHA_FRINGE_REPAIRED ${results.join(' ')}`);
}

async function repairTexture(filePath) {
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const original = new Uint8ClampedArray(imageData.data);
  const data = imageData.data;
  const bleed = buildBleedMap(original, image.width, image.height, 8);
  let changedPixels = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = pixelIndex(x, y, image.width);
      const alpha = original[index + 3];
      if (alpha >= 255) continue;
      const pixel = index / 4;
      if (!bleed.known[pixel]) continue;
      if (data[index] !== bleed.red[pixel] || data[index + 1] !== bleed.green[pixel] || data[index + 2] !== bleed.blue[pixel]) {
        data[index] = bleed.red[pixel];
        data[index + 1] = bleed.green[pixel];
        data[index + 2] = bleed.blue[pixel];
        changedPixels += 1;
      }
    }
  }

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = pixelIndex(x, y, image.width);
      const alpha = original[index + 3];
      if (alpha < 120 || alpha > 248) continue;
      const pixel = index / 4;
      if (!bleed.known[pixel]) continue;
      const luma = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      const sampleLuma = bleed.red[pixel] * 0.2126 + bleed.green[pixel] * 0.7152 + bleed.blue[pixel] * 0.0722;
      if (luma < sampleLuma + 32) continue;
      data[index] = Math.round((data[index] * 0.35) + (bleed.red[pixel] * 0.65));
      data[index + 1] = Math.round((data[index + 1] * 0.35) + (bleed.green[pixel] * 0.65));
      data[index + 2] = Math.round((data[index + 2] * 0.35) + (bleed.blue[pixel] * 0.65));
      changedPixels += 1;
    }
  }

  context.putImageData(imageData, 0, 0);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return { changedPixels };
}

function buildBleedMap(data, width, height, radius) {
  const count = width * height;
  const red = new Uint8Array(count);
  const green = new Uint8Array(count);
  const blue = new Uint8Array(count);
  const known = new Uint8Array(count);
  const nextKnown = new Uint8Array(count);

  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    if (data[index + 3] < 220) continue;
    red[pixel] = data[index];
    green[pixel] = data[index + 1];
    blue[pixel] = data[index + 2];
    known[pixel] = 1;
  }

  for (let pass = 0; pass < radius; pass += 1) {
    nextKnown.set(known);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width) + x;
        if (known[pixel]) continue;
        const neighbor = firstKnownNeighbor(known, width, height, x, y);
        if (neighbor === -1) continue;
        red[pixel] = red[neighbor];
        green[pixel] = green[neighbor];
        blue[pixel] = blue[neighbor];
        nextKnown[pixel] = 1;
      }
    }
    known.set(nextKnown);
  }

  return { red, green, blue, known };
}

function firstKnownNeighbor(known, width, height, x, y) {
  const candidates = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x - 1, y + 1],
    [x + 1, y + 1],
  ];
  for (const [nx, ny] of candidates) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const pixel = (ny * width) + nx;
    if (known[pixel]) return pixel;
  }
  return -1;
}

function pixelIndex(x, y, width) {
  return ((y * width) + x) * 4;
}
