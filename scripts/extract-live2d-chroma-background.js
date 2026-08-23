const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function usage() {
  console.error('Usage: node scripts/extract-live2d-chroma-background.js <input.png> <output.png>');
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

  let transparentPixels = 0;
  let partialPixels = 0;
  let opaquePixels = 0;
  let visibleGreenFringePixels = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const competing = Math.max(red, blue);
    const dominance = green - competing;

    let alpha = 255;
    if (green >= 100 && dominance >= 135) alpha = 0;
    else if (green >= 50 && dominance > 20) {
      alpha = Math.round(255 * (1 - Math.min(1, (dominance - 20) / 115)));
    }

    if (alpha === 0) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
      transparentPixels += 1;
      continue;
    }

    if (alpha < 255) {
      const neutralGreen = Math.max(red, blue);
      pixels[offset + 1] = Math.min(green, neutralGreen + 8);
      pixels[offset + 3] = alpha;
      partialPixels += 1;
    } else {
      opaquePixels += 1;
    }

    if (pixels[offset + 1] > Math.max(pixels[offset], pixels[offset + 2]) + 35) {
      visibleGreenFringePixels += 1;
    }
    if (alpha >= 24) {
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (transparentPixels === 0 || opaquePixels === 0 || maxX < 0) {
    throw new Error('Chroma extraction did not produce both foreground and transparent background.');
  }
  if (minX === 0 || minY === 0 || maxX === image.width - 1 || maxY === image.height - 1) {
    throw new Error('Chroma extraction produced an edge-clipped foreground.');
  }
  if (visibleGreenFringePixels > 100) {
    throw new Error(`Chroma extraction left too many visible green pixels: ${visibleGreenFringePixels}`);
  }

  context.putImageData(imageData, 0, 0);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, canvas.toBuffer('image/png'));

  console.log(JSON.stringify({
    input: path.resolve(input),
    output: path.resolve(output),
    width: image.width,
    height: image.height,
    transparentPixels,
    partialPixels,
    opaquePixels,
    visibleGreenFringePixels,
    foregroundBounds: { minX, minY, maxX, maxY },
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
