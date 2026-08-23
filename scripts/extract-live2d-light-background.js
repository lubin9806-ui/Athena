const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function usage() {
  console.error('Usage: node scripts/extract-live2d-light-background.js <input.png> <output.png>');
  process.exit(2);
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) usage();

  const image = await loadImage(input);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const pixels = imageData.data;
  const count = image.width * image.height;
  const background = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;

  const enqueue = index => {
    if (background[index] || !isLightNeutral(pixels, index)) return;
    background[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < image.width; x += 1) {
    enqueue(x);
    enqueue((image.height - 1) * image.width + x);
  }
  for (let y = 0; y < image.height; y += 1) {
    enqueue(y * image.width);
    enqueue(y * image.width + image.width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < image.width) enqueue(index + 1);
    if (y > 0) enqueue(index - image.width);
    if (y + 1 < image.height) enqueue(index + image.width);
  }

  let transparentPixels = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if (background[index]) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
      transparentPixels += 1;
      continue;
    }
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  featherForegroundEdge(pixels, background, image.width, image.height);

  context.putImageData(imageData, 0, 0);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, canvas.toBuffer('image/png'));

  const foregroundPixels = count - transparentPixels;
  if (foregroundPixels === 0 || minX === 0 || minY === 0 || maxX === image.width - 1 || maxY === image.height - 1) {
    throw new Error('Background extraction produced an invalid or edge-clipped foreground.');
  }
  console.log(JSON.stringify({
    input: path.resolve(input),
    output: path.resolve(output),
    width: image.width,
    height: image.height,
    transparentPixels,
    foregroundPixels,
    foregroundBounds: { minX, minY, maxX, maxY },
  }));
}

function featherForegroundEdge(pixels, background, width, height) {
  const originalAlpha = new Uint8Array(width * height);
  for (let index = 0; index < originalAlpha.length; index += 1) originalAlpha[index] = pixels[index * 4 + 3];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (background[index] || originalAlpha[index] === 0) continue;
      let transparentNeighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          if (background[(y + offsetY) * width + x + offsetX]) transparentNeighbors += 1;
        }
      }
      if (transparentNeighbors > 0) {
        pixels[index * 4 + 3] = Math.min(originalAlpha[index], transparentNeighbors >= 4 ? 112 : 176);
      }
    }
  }
}

function isLightNeutral(pixels, index) {
  const offset = index * 4;
  const red = pixels[offset];
  const green = pixels[offset + 1];
  const blue = pixels[offset + 2];
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const brightness = (red + green + blue) / 3;
  return brightness >= 225 && maximum - minimum <= 18;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
