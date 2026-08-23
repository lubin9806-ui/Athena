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
const REVIEW_ROOT = path.join(SOURCE_ROOT, 'review');
const ALIGNMENT_PREVIEW_PATH = path.join(REVIEW_ROOT, 'front-alignment-preview-v1.png');
const SCALE_PREVIEW_PATH = path.join(REVIEW_ROOT, 'front-source-scale-preview-v1.png');
const REVIEW_REPORT_PATH = path.join(REVIEW_ROOT, 'source-review-v1.json');

const GROUPS = ['Head', 'Eyes', 'Mouth', 'Body', 'SkirtAndLegs'];
const ALTERNATIVE_PARTS = new Set([
  'SSX_HAIR_REAR_LEFT', 'SSX_HAIR_REAR_RIGHT',
  'SSX_HAIR_BANGS_LEFT', 'SSX_HAIR_BANGS_RIGHT',
  'SSX_EYE_L_CLOSED', 'SSX_EYE_R_CLOSED',
  'SSX_MOUTH_OPEN_SMALL', 'SSX_MOUTH_OPEN_WIDE', 'SSX_MOUTH_FORM_EI',
  'SSX_MOUTH_FORM_OU', 'SSX_MOUTH_FORM_MBP',
  'SSX_HAND_CHEEK_L', 'SSX_HAND_CHEEK_R',
]);

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
    part('SSX_EYE_L_WHITE', 'Eyes', [399, 174, 38, 18]),
    part('SSX_EYE_L_IRIS', 'Eyes', [409, 174, 18, 18]),
    part('SSX_EYE_L_PUPIL', 'Eyes', [414, 179, 9, 9]),
    part('SSX_EYE_L_HIGHLIGHT', 'Eyes', [413, 176, 6, 6]),
    part('SSX_EYE_L_UPPER_LASH', 'Eyes', [396, 168, 44, 16]),
    part('SSX_EYE_L_LOWER_LASH', 'Eyes', [399, 187, 40, 9]),
    part('SSX_BROW_L', 'Eyes', [396, 151, 45, 12]),
    part('SSX_EYE_L_CLOSED', 'Eyes', [396, 175, 44, 14]),
    part('SSX_EYE_R_WHITE', 'Eyes', [467, 174, 38, 18]),
    part('SSX_EYE_R_IRIS', 'Eyes', [477, 174, 18, 18]),
    part('SSX_EYE_R_PUPIL', 'Eyes', [482, 179, 9, 9]),
    part('SSX_EYE_R_HIGHLIGHT', 'Eyes', [481, 176, 6, 6]),
    part('SSX_EYE_R_UPPER_LASH', 'Eyes', [464, 168, 44, 16]),
    part('SSX_EYE_R_LOWER_LASH', 'Eyes', [467, 187, 40, 9]),
    part('SSX_BROW_R', 'Eyes', [464, 151, 45, 12]),
    part('SSX_EYE_R_CLOSED', 'Eyes', [464, 175, 44, 14]),
  ]),
  atlas('mouths-atlas-v2-alpha.png', 3, 2, [
    part('SSX_MOUTH_CLOSED', 'Mouth', [433, 235, 54, 28]),
    part('SSX_MOUTH_OPEN_SMALL', 'Mouth', [433, 233, 54, 32]),
    part('SSX_MOUTH_OPEN_WIDE', 'Mouth', [431, 228, 58, 42]),
    part('SSX_MOUTH_FORM_EI', 'Mouth', [430, 234, 60, 30]),
    part('SSX_MOUTH_FORM_OU', 'Mouth', [440, 227, 40, 44]),
    part('SSX_MOUTH_FORM_MBP', 'Mouth', [433, 235, 54, 28]),
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
    partAt('SSX_HAND_CHEEK_L', 'Body', [300, 160, 135, 250], 11),
    partAt('SSX_ARM_UPPER_R', 'Body', [575, 430, 85, 230], 12),
    partAt('SSX_ARM_LOWER_R', 'Body', [575, 610, 125, 245], 13),
    partAt('SSX_HAND_CHEEK_R', 'Body', [485, 160, 135, 250], 15),
  ]),
  atlas('lower-body-atlas-v1-alpha.png', 4, 4, [
    part('SSX_WAIST_PELVIS_BASE', 'SkirtAndLegs', [330, 520, 260, 430]),
    part('SSX_SKIRT_WAIST', 'SkirtAndLegs', [280, 535, 360, 65]),
    part('SSX_SKIRT_REAR_BASE', 'SkirtAndLegs', [270, 560, 380, 405]),
    part('SSX_SKIRT_FRONT_BASE', 'SkirtAndLegs', [270, 560, 380, 405]),
    part('SSX_SKIRT_PLEATS_L', 'SkirtAndLegs', [270, 560, 260, 405]),
    part('SSX_SKIRT_PLEATS_CENTER', 'SkirtAndLegs', [330, 560, 260, 405]),
    part('SSX_SKIRT_PLEATS_R', 'SkirtAndLegs', [390, 560, 260, 405]),
    part('SSX_SKIRT_HEM_UNDERSIDE', 'SkirtAndLegs', [320, 900, 280, 80]),
    part('SSX_THIGH_L', 'SkirtAndLegs', [325, 930, 120, 330]),
    part('SSX_CALF_L', 'SkirtAndLegs', [335, 1200, 105, 365]),
    partAt('SSX_KNEE_OVERLAY_L', 'SkirtAndLegs', [330, 1100, 110, 120], 11),
    partAt('SSX_THIGH_R', 'SkirtAndLegs', [475, 930, 120, 330], 12),
    partAt('SSX_CALF_R', 'SkirtAndLegs', [480, 1200, 105, 365], 13),
    partAt('SSX_KNEE_OVERLAY_R', 'SkirtAndLegs', [480, 1100, 110, 120], 15),
  ]),
  atlas('hands-shoes-atlas-v2-alpha.png', 2, 2, [
    part('SSX_HAND_NEUTRAL_L', 'Body', [202, 785, 105, 155]),
    part('SSX_HAND_NEUTRAL_R', 'Body', [612, 785, 105, 155]),
    part('SSX_SHOE_L', 'SkirtAndLegs', [348, 1535, 90, 135]),
    part('SSX_SHOE_R', 'SkirtAndLegs', [480, 1535, 90, 135]),
  ]),
];

async function main() {
  fs.mkdirSync(LAYERS_ROOT, { recursive: true });
  fs.mkdirSync(REVIEW_ROOT, { recursive: true });
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
      const cell = gridCell(image.width, image.height, atlasSpec.columns, atlasSpec.rows, spec.cellIndex ?? index);
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
  await buildAlignmentPreview(inventory);
  await buildScalePreview();
  buildReviewReport(inventory);
  await buildPsd(inventory);
  console.log(`SU_SHIXIA_LIVE2D_SOURCE_BUILD_OK parts=${inventory.length} groups=${GROUPS.length} psd=${PSD_PATH}`);
}

async function buildScalePreview() {
  const master = await loadImage(MASTER_PATH);
  const canvas = createCanvas(1400, 820);
  const context = canvas.getContext('2d');
  context.fillStyle = '#e7eaed';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const variants = [
    { label: 'CHAT RIGHT 720 PX', height: 720 },
    { label: 'DRAGGABLE OVERLAY 520 PX', height: 520 },
    { label: 'DESKTOP PET 360 PX', height: 360 },
    { label: 'COMPACT 220 PX', height: 220 },
  ];
  const columnWidth = canvas.width / variants.length;
  const baseline = 775;
  context.font = '16px Segoe UI';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const left = index * columnWidth;
    context.fillStyle = index % 2 === 0 ? '#f8f9fa' : '#f2f4f6';
    context.fillRect(left + 4, 4, columnWidth - 8, canvas.height - 8);
    context.fillStyle = '#20262d';
    context.fillText(variant.label, left + columnWidth / 2, 28, columnWidth - 20);
    const width = master.width * (variant.height / master.height);
    context.drawImage(master, left + (columnWidth - width) / 2, baseline - variant.height, width, variant.height);
    context.fillStyle = '#9aa3aa';
    context.fillRect(left + 25, baseline, columnWidth - 50, 1);
  }

  fs.writeFileSync(SCALE_PREVIEW_PATH, canvas.toBuffer('image/png'));
}

async function buildAlignmentPreview(inventory) {
  const master = await loadImage(MASTER_PATH);
  const panelWidth = 460;
  const panelHeight = 880;
  const board = createCanvas(panelWidth * 3, panelHeight * 2);
  const context = board.getContext('2d');
  context.fillStyle = '#dfe4e8';
  context.fillRect(0, 0, board.width, board.height);

  const panels = [
    { title: 'REFERENCE MASTER', referenceOnly: true },
    { title: 'HEAD DEFAULT STATE', groups: ['Head'] },
    { title: 'FACE DEFAULT STATE', groups: ['Eyes', 'Mouth'] },
    { title: 'UPPER BODY DEFAULT STATE', groups: ['Body'] },
    { title: 'LOWER BODY DEFAULT STATE', groups: ['SkirtAndLegs'] },
    { title: 'DEFAULT GENERATED STATE', groups: ['SkirtAndLegs', 'Body', 'Head', 'Eyes', 'Mouth'] },
  ];

  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    const left = (index % 3) * panelWidth;
    const top = Math.floor(index / 3) * panelHeight;
    context.fillStyle = '#f8f9fa';
    context.fillRect(left + 5, top + 5, panelWidth - 10, panelHeight - 10);
    context.fillStyle = '#20262d';
    context.font = '16px Segoe UI';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(panel.title, left + panelWidth / 2, top + 25);

    const scale = Math.min((panelWidth - 30) / master.width, (panelHeight - 65) / master.height);
    const drawWidth = master.width * scale;
    const drawHeight = master.height * scale;
    const drawLeft = left + (panelWidth - drawWidth) / 2;
    const drawTop = top + 50 + (panelHeight - 60 - drawHeight) / 2;

    if (panel.referenceOnly) {
      context.drawImage(master, drawLeft, drawTop, drawWidth, drawHeight);
      continue;
    }

    context.save();
    context.globalAlpha = 0.16;
    context.drawImage(master, drawLeft, drawTop, drawWidth, drawHeight);
    context.restore();

    for (const group of panel.groups) {
      const groupItems = defaultPreviewItems(inventory, group);
      for (const item of groupItems) {
        const image = await loadImage(path.join(PARTS_ROOT, item.file));
        const [x, y, width, height] = item.targetRect;
        context.drawImage(
          image,
          drawLeft + x * scale,
          drawTop + y * scale,
          width * scale,
          height * scale,
        );
      }
    }
  }

  fs.writeFileSync(ALIGNMENT_PREVIEW_PATH, board.toBuffer('image/png'));
}

function buildReviewReport(inventory) {
  const geometry = inventory.map(item => {
    const [, , targetWidth, targetHeight] = item.targetRect;
    const sourceAspect = item.width / item.height;
    const targetAspect = targetWidth / targetHeight;
    const aspectDistortion = Math.max(sourceAspect / targetAspect, targetAspect / sourceAspect);
    const [left, top] = item.targetRect;
    return {
      name: item.name,
      aspectDistortion: Number(aspectDistortion.toFixed(3)),
      targetInsideCanvas: left >= 0 && top >= 0 && left + targetWidth <= 919 && top + targetHeight <= 1712,
    };
  });
  const report = {
    version: 1,
    reviewedAt: '2026-08-24',
    status: 'front_source_refinement_review_required',
    summary: {
      parts: inventory.length,
      allTargetsInsideCanvas: geometry.every(item => item.targetInsideCanvas),
      highAspectDistortionCount: geometry.filter(item => item.aspectDistortion > 2).length,
      alignmentPreview: 'front-alignment-preview-v1.png',
      scalePreview: 'front-source-scale-preview-v1.png',
    },
    refinements: [
      'Replaced the first mouth atlas with a softer six-state v2 atlas derived from the approved face style.',
      'Replaced neutral hands and side-view shoes with a dedicated front-view corrective atlas.',
      'Added a deterministic placement preview for the master, face, head, upper body, lower body, and all parts.',
      'Marked mutually exclusive hair, eye, mouth, and cheek-touch layers hidden by default in the PSD.',
      'Retained source and generated intermediates for provenance and non-destructive review.',
    ],
    openFindings: [
      { area: 'mouth', severity: 'medium', status: 'provisional', note: 'Style is softer than v1 but still requires final illustrator and Cubism deformation review.' },
      { area: 'hands', severity: 'medium', status: 'provisional', note: 'Neutral and cheek-touch variants exist; anatomy, wrist joins, and hidden fill require rigger review.' },
      { area: 'hidden-fill', severity: 'high', status: 'required', note: 'Automated torso, blouse, skirt, and limb fills are not a substitute for hand-painted occluded regions.' },
      { area: 'alignment', severity: 'high', status: 'required', note: 'Target rectangles are production estimates and need user-visible approval before Cubism import.' },
      { area: 'display-scale', severity: 'medium', status: 'runtime-rule', note: 'A 220 px full-body render cannot carry readable facial emotion; compact placement must use a bust crop or a larger minimum height.' },
      { area: 'multi-view', severity: 'high', status: 'not-started', note: 'Profile and back source packages remain separate future work.' },
    ],
    geometry,
    gate: 'Do not begin genuine Cubism rigging until the front alignment preview and provisional findings receive human approval.',
  };
  fs.writeFileSync(REVIEW_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
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
      hidden: ALTERNATIVE_PARTS.has(item.name),
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
  if (parts.length > columns * rows) throw new Error(`Atlas ${file} has more parts than cells.`);
  const indexes = parts.map((item, index) => item.cellIndex ?? index);
  if (new Set(indexes).size !== indexes.length || indexes.some(index => index < 0 || index >= columns * rows)) {
    throw new Error(`Atlas ${file} has invalid cell indexes.`);
  }
  return { file, columns, rows, parts };
}

function part(name, group, targetRect) {
  return { name, group, targetRect };
}

function partAt(name, group, targetRect, cellIndex) {
  return { name, group, targetRect, cellIndex };
}

function defaultPreviewItems(inventory, group) {
  const order = [
    'SSX_HAIR_REAR_CENTER', 'SSX_HEAD_NECK', 'SSX_HEAD_FACE_BASE',
    'SSX_HAIR_SIDE_LOCK_LEFT', 'SSX_HAIR_SIDE_LOCK_RIGHT', 'SSX_HAIR_BANGS_CENTER',
    'SSX_HAIR_LOOSE_STRANDS', 'SSX_ACCESSORY_HAIR_CLIP',
    'SSX_EYE_L_WHITE', 'SSX_EYE_L_IRIS', 'SSX_EYE_L_PUPIL', 'SSX_EYE_L_HIGHLIGHT',
    'SSX_EYE_L_UPPER_LASH', 'SSX_EYE_L_LOWER_LASH', 'SSX_BROW_L',
    'SSX_EYE_R_WHITE', 'SSX_EYE_R_IRIS', 'SSX_EYE_R_PUPIL', 'SSX_EYE_R_HIGHLIGHT',
    'SSX_EYE_R_UPPER_LASH', 'SSX_EYE_R_LOWER_LASH', 'SSX_BROW_R', 'SSX_MOUTH_CLOSED',
    'SSX_TORSO_BASE', 'SSX_BLOUSE_BACK_FILL',
    'SSX_ARM_UPPER_L', 'SSX_ARM_LOWER_L', 'SSX_ARM_UPPER_R', 'SSX_ARM_LOWER_R',
    'SSX_BLOUSE_FRONT', 'SSX_BLOUSE_COLLAR_L', 'SSX_BLOUSE_COLLAR_R',
    'SSX_BLOUSE_SLEEVE_L', 'SSX_BLOUSE_SLEEVE_R', 'SSX_BLOUSE_BUTTON_PLACKET',
    'SSX_HAND_NEUTRAL_L', 'SSX_HAND_NEUTRAL_R',
    'SSX_WAIST_PELVIS_BASE',
    'SSX_THIGH_L', 'SSX_CALF_L', 'SSX_KNEE_OVERLAY_L', 'SSX_SHOE_L',
    'SSX_THIGH_R', 'SSX_CALF_R', 'SSX_KNEE_OVERLAY_R', 'SSX_SHOE_R',
    'SSX_SKIRT_REAR_BASE', 'SSX_SKIRT_HEM_UNDERSIDE', 'SSX_SKIRT_FRONT_BASE',
    'SSX_SKIRT_PLEATS_L', 'SSX_SKIRT_PLEATS_CENTER', 'SSX_SKIRT_PLEATS_R', 'SSX_SKIRT_WAIST',
  ];
  const orderByName = new Map(order.map((name, index) => [name, index]));
  return inventory
    .filter(item => item.group === group && orderByName.has(item.name))
    .sort((left, right) => orderByName.get(left.name) - orderByName.get(right.name));
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
