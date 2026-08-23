const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, ImageData } = require('@napi-rs/canvas');
const { initializeCanvas, writePsdBuffer, readPsd } = require('ag-psd');

initializeCanvas(createCanvas, (width, height) => new ImageData(width, height));

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'source');
const PARTS_ROOT = path.join(SOURCE_ROOT, 'parts');
const LAYERS_ROOT = path.join(PARTS_ROOT, 'layers-v1');
const MASTER_PATH = path.join(SOURCE_ROOT, 'su-shixia-front-master-v2-alpha.png');
const INVENTORY_PATH = path.join(PARTS_ROOT, 'parts-inventory-v1.json');
const LAYOUT_PATH = path.join(PARTS_ROOT, 'parts-layout-v1.json');
const CONTACT_SHEET_PATH = path.join(PARTS_ROOT, 'parts-contact-sheet-v1.png');
const PSD_PATH = path.join(SOURCE_ROOT, 'su-shixia-front-layered-v1.psd');

const GROUPS = ['Head', 'Eyes', 'Mouth', 'Body', 'SkirtAndLegs'];

const ATLASES = [
  atlas('head-hair-atlas-v1-alpha.png', 4, 3, [
    part('SSX_HEAD_FACE_BASE', 'Head', [365, 85, 190, 275]),
    part('SSX_HEAD_NECK', 'Head', [405, 255, 110, 125]),
    part('SSX_HAIR_REAR_CENTER', 'Head', [330, 40, 260, 330]),
    part('SSX_HAIR_REAR_LEFT', 'Head', [325, 70, 150, 310]),
    part('SSX_HAIR_REAR_RIGHT', 'Head', [445, 70, 150, 310]),
    part('SSX_HAIR_BANGS_CENTER', 'Head', [350, 45, 220, 165]),
    part('SSX_HAIR_BANGS_LEFT', 'Head', [335, 55, 170, 180]),
    part('SSX_HAIR_BANGS_RIGHT', 'Head', [415, 55, 170, 180]),
    part('SSX_HAIR_SIDE_LOCK_LEFT', 'Head', [325, 115, 130, 270]),
    part('SSX_HAIR_SIDE_LOCK_RIGHT', 'Head', [465, 115, 130, 270]),
    part('SSX_HAIR_LOOSE_STRANDS', 'Head', [315, 90, 290, 305]),
    part('SSX_ACCESSORY_HAIR_CLIP', 'Head', [510, 115, 48, 48]),
  ]),
  atlas('eyes-brows-atlas-v1-alpha.png', 4, 4, [
    part('SSX_EYE_L_WHITE', 'Eyes', [388, 169, 58, 32]),
    part('SSX_EYE_L_IRIS', 'Eyes', [402, 169, 30, 30]),
    part('SSX_EYE_L_PUPIL', 'Eyes', [410, 176, 15, 15]),
    part('SSX_EYE_L_HIGHLIGHT', 'Eyes', [408, 171, 10, 10]),
    part('SSX_EYE_L_UPPER_LASH', 'Eyes', [383, 158, 69, 30]),
    part('SSX_EYE_L_LOWER_LASH', 'Eyes', [387, 185, 64, 16]),
    part('SSX_BROW_L', 'Eyes', [384, 141, 67, 20]),
    part('SSX_EYE_L_CLOSED', 'Eyes', [383, 171, 70, 26]),
    part('SSX_EYE_R_WHITE', 'Eyes', [457, 169, 58, 32]),
    part('SSX_EYE_R_IRIS', 'Eyes', [471, 169, 30, 30]),
    part('SSX_EYE_R_PUPIL', 'Eyes', [479, 176, 15, 15]),
    part('SSX_EYE_R_HIGHLIGHT', 'Eyes', [477, 171, 10, 10]),
    part('SSX_EYE_R_UPPER_LASH', 'Eyes', [452, 158, 69, 30]),
    part('SSX_EYE_R_LOWER_LASH', 'Eyes', [456, 185, 64, 16]),
    part('SSX_BROW_R', 'Eyes', [453, 141, 67, 20]),
    part('SSX_EYE_R_CLOSED', 'Eyes', [452, 171, 70, 26]),
  ]),
  atlas('mouths-atlas-v1-alpha.png', 3, 2, [
    part('SSX_MOUTH_CLOSED', 'Mouth', [421, 229, 78, 48]),
    part('SSX_MOUTH_OPEN_SMALL', 'Mouth', [421, 229, 78, 48]),
    part('SSX_MOUTH_OPEN_WIDE', 'Mouth', [417, 221, 86, 66]),
    part('SSX_MOUTH_FORM_EI', 'Mouth', [416, 227, 88, 52]),
    part('SSX_MOUTH_FORM_OU', 'Mouth', [426, 222, 68, 64]),
    part('SSX_MOUTH_FORM_MBP', 'Mouth', [421, 229, 78, 48]),
  ]),
  atlas('upper-body-atlas-v1-alpha.png', 4, 4, [
    part('SSX_TORSO_BASE', 'Body', [335, 275, 250, 310]),
    part('SSX_BLOUSE_FRONT', 'Body', [285, 300, 350, 300]),
    part('SSX_BLOUSE_COLLAR_L', 'Body', [350, 302, 110, 95]),
    part('SSX_BLOUSE_COLLAR_R', 'Body', [460, 302, 110, 95]),
    part('SSX_BLOUSE_SLEEVE_L', 'Body', [270, 345, 130, 165]),
    part('SSX_BLOUSE_SLEEVE_R', 'Body', [520, 345, 130, 165]),
    part('SSX_BLOUSE_BUTTON_PLACKET', 'Body', [440, 340, 40, 205]),
    part('SSX_BLOUSE_BACK_FILL', 'Body', [300, 295, 320, 310]),
    part('SSX_ARM_UPPER_L', 'Body', [260, 430, 85, 230]),
    part('SSX_ARM_LOWER_L', 'Body', [220, 610, 125, 245]),
    part('SSX_HAND_NEUTRAL_L', 'Body', [202, 785, 105, 155]),
    part('SSX_HAND_CHEEK_L', 'Body', [300, 160, 135, 250]),
    part('SSX_ARM_UPPER_R', 'Body', [575, 430, 85, 230]),
    part('SSX_ARM_LOWER_R', 'Body', [575, 610, 125, 245]),
    part('SSX_HAND_NEUTRAL_R', 'Body', [612, 785, 105, 155]),
    part('SSX_HAND_CHEEK_R', 'Body', [485, 160, 135, 250]),
  ]),
  atlas('lower-body-atlas-v1-alpha.png', 4, 4, [
    part('SSX_WAIST_PELVIS_BASE', 'SkirtAndLegs', [330, 520, 260, 430]),
    part('SSX_SKIRT_WAIST', 'SkirtAndLegs', [280, 535, 360, 65]),
    part('SSX_SKIRT_REAR_BASE', 'SkirtAndLegs', [270, 560, 380, 405]),
    part('SSX_SKIRT_FRONT_BASE', 'SkirtAndLegs', [270, 560, 380, 405]),
    part('SSX_SKIRT_PLEATS_L', 'SkirtAndLegs', [270, 560, 155, 405]),
    part('SSX_SKIRT_PLEATS_CENTER', 'SkirtAndLegs', [380, 560, 160, 405]),
    part('SSX_SKIRT_PLEATS_R', 'SkirtAndLegs', [495, 560, 155, 405]),
    part('SSX_SKIRT_HEM_UNDERSIDE', 'SkirtAndLegs', [275, 920, 370, 55]),
    part('SSX_THIGH_L', 'SkirtAndLegs', [325, 930, 120, 330]),
    part('SSX_CALF_L', 'SkirtAndLegs', [335, 1200, 105, 365]),
    part('SSX_SHOE_L', 'SkirtAndLegs', [325, 1510, 125, 160]),
    part('SSX_KNEE_OVERLAY_L', 'SkirtAndLegs', [330, 1100, 110, 120]),
    part('SSX_THIGH_R', 'SkirtAndLegs', [475, 930, 120, 330]),
    part('SSX_CALF_R', 'SkirtAndLegs', [480, 1200, 105, 365]),
    part('SSX_SHOE_R', 'SkirtAndLegs', [470, 1510, 125, 160]),
    part('SSX_KNEE_OVERLAY_R', 'SkirtAndLegs', [480, 1100, 110, 120]),
  ]),
];

async function main() {
  fs.mkdirSync(LAYERS_ROOT, { recursive: true });
  const inventory = [];
  const layout = { version: 1, outputDirectory: 'layers-v1', atlases: [] };

  for (const atlasSpec of ATLASES) {
    const atlasPath = path.join(PARTS_ROOT, atlasSpec.file);
    const image = await loadImage(atlasPath);
    const sourceCanvas = createCanvas(image.width, image.height);
    const sourceContext = sourceCanvas.getContext('2d');
    sourceContext.drawImage(image, 0, 0);
    const layoutAtlas = {
      file: atlasSpec.file,
      columns: atlasSpec.columns,
      rows: atlasSpec.rows,
      width: image.width,
      height: image.height,
      parts: [],
    };

    for (let index = 0; index < atlasSpec.parts.length; index += 1) {
      const spec = atlasSpec.parts[index];
      const cell = gridCell(image.width, image.height, atlasSpec.columns, atlasSpec.rows, index);
      const crop = sourceContext.getImageData(cell.x, cell.y, cell.width, cell.height);
      const bounds = alphaBounds(crop.data, cell.width, cell.height);
      if (!bounds || bounds.pixelCount < 40) throw new Error(`Part is empty or too small: ${spec.name}`);
      const padded = paddedBounds(bounds, cell.width, cell.height, 6);
      const outputCanvas = createCanvas(padded.width, padded.height);
      const outputContext = outputCanvas.getContext('2d');
      outputContext.drawImage(
        sourceCanvas,
        cell.x + padded.x,
        cell.y + padded.y,
        padded.width,
        padded.height,
        0,
        0,
        padded.width,
        padded.height,
      );
      const fileName = `${spec.name}.png`;
      fs.writeFileSync(path.join(LAYERS_ROOT, fileName), outputCanvas.toBuffer('image/png'));
      const sourceRect = [cell.x, cell.y, cell.width, cell.height];
      const sourceOffset = [cell.x + padded.x, cell.y + padded.y];
      inventory.push({
        name: spec.name,
        group: spec.group,
        file: `layers-v1/${fileName}`,
        sourceAtlas: atlasSpec.file,
        sourceRect,
        sourceOffset,
        width: padded.width,
        height: padded.height,
        pixelCount: bounds.pixelCount,
        targetRect: spec.targetRect,
      });
      layoutAtlas.parts.push({ name: spec.name, group: spec.group, sourceRect, targetRect: spec.targetRect });
    }
    layout.atlases.push(layoutAtlas);
  }

  fs.writeFileSync(LAYOUT_PATH, `${JSON.stringify(layout, null, 2)}\n`);
  fs.writeFileSync(INVENTORY_PATH, `${JSON.stringify({ version: 1, count: inventory.length, parts: inventory }, null, 2)}\n`);
  await buildContactSheet(inventory);
  await buildPsd(inventory);
  console.log(`SU_SHIXIA_LIVE2D_SOURCE_BUILD_OK parts=${inventory.length} groups=${GROUPS.length} psd=${PSD_PATH}`);
}

async function buildContactSheet(inventory) {
  const columns = 5;
  const cellWidth = 300;
  const cellHeight = 240;
  const rows = Math.ceil(inventory.length / columns);
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#dfe4e8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '14px Segoe UI';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < inventory.length; index += 1) {
    const item = inventory[index];
    const image = await loadImage(path.join(PARTS_ROOT, item.file));
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    context.fillStyle = '#f8f9fa';
    context.fillRect(left + 4, top + 4, cellWidth - 8, cellHeight - 8);
    const maxWidth = cellWidth - 28;
    const maxHeight = cellHeight - 54;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1.5);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, left + (cellWidth - width) / 2, top + 10 + (maxHeight - height) / 2, width, height);
    context.fillStyle = '#20262d';
    context.fillText(item.name, left + cellWidth / 2, top + cellHeight - 22, cellWidth - 20);
  }

  fs.writeFileSync(CONTACT_SHEET_PATH, canvas.toBuffer('image/png'));
}

async function buildPsd(inventory) {
  const master = await loadImage(MASTER_PATH);
  const grouped = new Map(GROUPS.map(group => [group, []]));
  for (const item of inventory) {
    const image = await loadImage(path.join(PARTS_ROOT, item.file));
    const [left, top, width, height] = item.targetRect;
    grouped.get(item.group).push({
      name: item.name,
      left,
      top,
      imageData: resizeImageData(image, width, height),
    });
  }
  const masterImageData = imageDataFromImage(master);
  const psd = {
    width: master.width,
    height: master.height,
    imageData: masterImageData,
    children: [
      { name: 'SSX_REFERENCE_COMPOSITE', left: 0, top: 0, imageData: masterImageData },
      ...[...grouped.entries()].map(([name, children]) => ({ name, hidden: true, opened: true, children })),
    ],
  };
  fs.writeFileSync(PSD_PATH, writePsdBuffer(psd, { generateThumbnail: true }));

  const verified = readPsd(fs.readFileSync(PSD_PATH), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const names = flattenNames(verified.children || []);
  const missing = inventory.map(item => item.name).filter(name => !names.includes(name));
  if (missing.length > 0) throw new Error(`PSD is missing layers: ${missing.join(', ')}`);
  if (names.length !== inventory.length + GROUPS.length + 1) {
    throw new Error(`Unexpected PSD layer count: ${names.length}`);
  }
}

function atlas(file, columns, rows, parts) {
  if (parts.length !== columns * rows) throw new Error(`Atlas ${file} must fill its declared grid.`);
  return { file, columns, rows, parts };
}

function part(name, group, targetRect) {
  return { name, group, targetRect };
}

function gridCell(width, height, columns, rows, index) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = Math.floor((column * width) / columns);
  const y = Math.floor((row * height) / rows);
  const maxX = Math.floor(((column + 1) * width) / columns);
  const maxY = Math.floor(((row + 1) * height) / rows);
  return { x, y, width: maxX - x, height: maxY - y };
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

function paddedBounds(bounds, width, height, padding) {
  const x = Math.max(0, bounds.minX - padding);
  const y = Math.max(0, bounds.minY - padding);
  const maxX = Math.min(width - 1, bounds.maxX + padding);
  const maxY = Math.min(height - 1, bounds.maxY + padding);
  return { x, y, width: maxX - x + 1, height: maxY - y + 1 };
}

function imageDataFromImage(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

function resizeImageData(image, width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function flattenNames(children) {
  const names = [];
  for (const child of children) {
    names.push(child.name || '');
    if (child.children) names.push(...flattenNames(child.children));
  }
  return names;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
