const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, ImageData } = require('@napi-rs/canvas');
const { initializeCanvas, writePsdBuffer, readPsd } = require('ag-psd');

initializeCanvas(createCanvas, (width, height) => new ImageData(width, height));

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');
const PARTS_ROOT = path.join(PACKAGE_ROOT, 'source', 'parts');
const MASTER_PATH = path.join(PACKAGE_ROOT, 'source', 'athena-live2d-default-front-v2-alpha.png');
const INVENTORY_PATH = path.join(PARTS_ROOT, 'parts-inventory-v1.json');
const OUTPUT_PATH = path.join(PACKAGE_ROOT, 'source', 'athena-live2d-default-layered-v1.psd');

async function main() {
  const master = await loadImage(MASTER_PATH);
  const masterImageData = imageDataFromImage(master);
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const groups = new Map([
    ['Head', []],
    ['Eyes', []],
    ['Mouth', []],
    ['Body', []],
    ['SkirtAndLegs', []],
  ]);

  for (const part of inventory.parts) {
    const image = await loadImage(path.join(PARTS_ROOT, part.file));
    const target = targetFor(part.name);
    const group = groups.get(groupFor(part.name));
    if (!group) throw new Error(`Missing PSD group for ${part.name}`);
    group.push({
      name: part.name,
      left: target.left,
      top: target.top,
      imageData: resizeImageData(image, target.width, target.height),
    });
  }

  const children = [
    {
      name: 'ATH_REFERENCE_COMPOSITE',
      left: 0,
      top: 0,
      imageData: masterImageData,
    },
    ...[...groups.entries()].map(([name, layers]) => ({
      name,
      hidden: true,
      opened: true,
      children: layers,
    })),
  ];
  const psd = {
    width: master.width,
    height: master.height,
    imageData: masterImageData,
    children,
  };
  fs.writeFileSync(OUTPUT_PATH, writePsdBuffer(psd, { generateThumbnail: true }));

  const verified = readPsd(fs.readFileSync(OUTPUT_PATH), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const names = flattenNames(verified.children || []);
  const missing = inventory.parts.map(part => part.name).filter(name => !names.includes(name));
  if (missing.length > 0) throw new Error(`PSD is missing layers: ${missing.join(', ')}`);
  if (names.length !== inventory.parts.length + groups.size + 1) {
    throw new Error(`Unexpected PSD layer count: ${names.length}`);
  }
  console.log(`ATHENA_LIVE2D_PSD_OK file=${OUTPUT_PATH} width=${verified.width} height=${verified.height} parts=${inventory.parts.length} groups=${groups.size}`);
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

function groupFor(name) {
  if (/^ATH_(HEAD|HAIR|ACCESSORY)/.test(name)) return 'Head';
  if (/^ATH_(EYE|BROW)/.test(name)) return 'Eyes';
  if (/^ATH_MOUTH/.test(name)) return 'Mouth';
  if (/^ATH_(TORSO|BLOUSE|ARM)/.test(name)) return 'Body';
  if (/^ATH_(SKIRT|LEG|SOCK|SHOE)/.test(name)) return 'SkirtAndLegs';
  throw new Error(`Unable to group layer: ${name}`);
}

function targetFor(name) {
  const direct = TARGETS[name];
  if (direct) return rect(direct);
  if (name.startsWith('ATH_MOUTH_')) return rect([423, 244, 54, 32]);
  if (name.startsWith('ATH_SKIRT_PLEAT_')) {
    const index = Number(name.slice(-2)) - 1;
    return rect([292 + index * 62, 555, 82, 330]);
  }
  throw new Error(`Missing target placement for ${name}`);
}

function rect([left, top, width, height]) {
  return { left, top, width, height };
}

function flattenNames(children) {
  const names = [];
  for (const child of children) {
    names.push(child.name || '');
    if (child.children) names.push(...flattenNames(child.children));
  }
  return names;
}

const TARGETS = {
  ATH_HEAD_FACE_BASE: [378, 105, 144, 205],
  ATH_HEAD_NECK: [414, 270, 72, 92],
  ATH_HAIR_BACK_BASE: [330, 48, 240, 340],
  ATH_HAIR_SIDE_L: [324, 115, 128, 270],
  ATH_HAIR_SIDE_R: [448, 115, 128, 270],
  ATH_HAIR_BANGS_CENTER: [350, 54, 200, 145],
  ATH_HAIR_BANGS_L: [335, 65, 150, 155],
  ATH_HAIR_BANGS_R: [415, 65, 150, 155],
  ATH_HAIR_LOOSE_STRAND_L: [326, 105, 92, 278],
  ATH_HAIR_LOOSE_STRAND_R: [485, 105, 92, 278],
  ATH_ACCESSORY_HAIR_CLIP: [520, 126, 42, 42],
  ATH_EYE_L_WHITE: [389, 169, 56, 30],
  ATH_EYE_R_WHITE: [455, 169, 56, 30],
  ATH_EYE_L_IRIS: [404, 170, 27, 27],
  ATH_EYE_R_IRIS: [470, 170, 27, 27],
  ATH_EYE_L_PUPIL: [411, 177, 14, 14],
  ATH_EYE_R_PUPIL: [477, 177, 14, 14],
  ATH_EYE_L_HIGHLIGHT: [410, 173, 8, 8],
  ATH_EYE_R_HIGHLIGHT: [476, 173, 8, 8],
  ATH_EYE_L_UPPER_LASH: [384, 160, 67, 27],
  ATH_EYE_R_UPPER_LASH: [450, 160, 67, 27],
  ATH_EYE_L_LOWER_LASH: [388, 185, 62, 15],
  ATH_EYE_R_LOWER_LASH: [451, 185, 62, 15],
  ATH_EYE_L_CLOSED: [384, 172, 68, 24],
  ATH_EYE_R_CLOSED: [449, 172, 68, 24],
  ATH_BROW_L: [385, 142, 65, 18],
  ATH_BROW_R: [451, 142, 65, 18],
  ATH_TORSO_BASE: [347, 286, 206, 285],
  ATH_BLOUSE_BASE: [292, 300, 316, 270],
  ATH_BLOUSE_SLEEVE_L: [274, 340, 108, 138],
  ATH_BLOUSE_SLEEVE_R: [518, 340, 108, 138],
  ATH_BLOUSE_COLLAR_L: [355, 304, 92, 90],
  ATH_BLOUSE_COLLAR_R: [453, 304, 92, 90],
  ATH_BLOUSE_POCKET: [504, 384, 68, 88],
  ATH_BLOUSE_BUTTONS: [441, 350, 18, 170],
  ATH_BLOUSE_CYAN_TRIM: [325, 325, 250, 120],
  ATH_BLOUSE_RIBBON: [419, 335, 62, 94],
  ATH_ARM_UPPER_L: [260, 426, 76, 210],
  ATH_ARM_UPPER_R: [564, 426, 76, 210],
  ATH_ARM_LOWER_L_HAND: [207, 600, 154, 285],
  ATH_ARM_LOWER_R_HAND: [539, 600, 154, 285],
  ATH_SKIRT_WAIST: [292, 518, 316, 52],
  ATH_SKIRT_BASE: [266, 544, 368, 360],
  ATH_SKIRT_CYAN_ACCENT: [520, 815, 105, 50],
  ATH_LEG_L: [333, 872, 105, 570],
  ATH_LEG_R: [462, 872, 105, 570],
  ATH_SOCK_L: [340, 1390, 88, 105],
  ATH_SOCK_R: [472, 1390, 88, 105],
  ATH_SHOE_L: [319, 1460, 128, 155],
  ATH_SHOE_R: [453, 1460, 128, 155]
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
