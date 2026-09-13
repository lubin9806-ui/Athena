// Renders the nine "总有一天" posters at 1536 x 2048 through Electron's
// offscreen compositor, so the runtime screenshots land in the poster as the
// exact pixels the packaged app produced.
//
//   node_modules\.bin\electron.cmd promo\campaign-20260907-someday\tools\build-posters.cjs

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const { posters, campaign, labels } = require('./poster-content.cjs');
const {
  renderPoster, renderContactSheet, WIDTH, HEIGHT, SHEET_W, SHEET_H, SCALE, STAGE_W, STAGE_H,
} = require('./poster-html.cjs');

const campaignRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(campaignRoot, 'source');
const buildRoot = path.join(campaignRoot, '.build');
const outputRoot = path.join(campaignRoot, 'posters');

const only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));

function assetsFor(poster) {
  const assets = {};
  if (poster.art) {
    const file = path.join(sourceRoot, 'art', poster.art);
    assert(fs.existsSync(file), `missing art plate ${file}`);
    assets.art = pathToFileURL(file).href;
  }
  if (poster.shot) {
    const file = path.join(sourceRoot, 'runtime', poster.shot);
    assert(fs.existsSync(file), `missing runtime capture ${file}`);
    assets.shot = pathToFileURL(file).href;
  }
  return assets;
}

const SETTLED = `
  Promise.all(Array.from(document.images).map(image => image.complete
    ? null
    : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })))
    .then(() => document.fonts.ready)
    .then(() => Array.from(document.images).every(image => image.naturalWidth > 0))`;

async function renderOne(win, poster) {
  const htmlPath = path.join(buildRoot, `${poster.id}.html`);
  fs.writeFileSync(htmlPath, renderPoster(poster, assetsFor(poster)), 'utf8');

  await win.loadFile(htmlPath);
  const imagesDecoded = await win.webContents.executeJavaScript(SETTLED);
  assert.equal(imagesDecoded, true, `${poster.id}: an image failed to decode`);
  await new Promise(resolve => setTimeout(resolve, 400));

  const image = await win.webContents.capturePage();
  assert(!image.isEmpty(), `${poster.id}: empty capture`);

  // NativeImage reports DIPs; the poster size lives in the PNG header.
  const png = image.toPNG({ scaleFactor: SCALE });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${poster.id}: not a PNG`);
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  assert.equal(size.width, WIDTH, `${poster.id}: captured width ${size.width}`);
  assert.equal(size.height, HEIGHT, `${poster.id}: captured height ${size.height}`);

  const outputPath = path.join(outputRoot, `athena-someday-${poster.id}.png`);
  fs.writeFileSync(outputPath, png);
  console.log(`POSTER_OK ${poster.id} ${size.width}x${size.height} ${png.length} bytes`);

  return {
    id: poster.id,
    index: poster.index,
    kind: poster.kind,
    file: path.basename(outputPath),
    width: size.width,
    height: size.height,
    bytes: png.length,
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
    source: poster.art ? `source/art/${poster.art}` : `source/runtime/${poster.shot}`,
    headline: Array.isArray(poster.headline) ? poster.headline.join('') : poster.headline,
  };
}

async function main() {
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  await app.whenReady();

  const win = new BrowserWindow({
    width: STAGE_W,
    height: STAGE_H,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: false },
  });
  // The constructor clamps to the display; a later setContentSize does not.
  win.setContentSize(STAGE_W, STAGE_H);
  win.webContents.setFrameRate(30);

  const selected = only.length ? posters.filter(p => only.some(arg => p.id.includes(arg))) : posters;
  assert(selected.length > 0, 'no poster matched the argument');

  const rendered = [];
  for (const poster of selected) rendered.push(await renderOne(win, poster));

  if (selected.length === posters.length) {
    const sheetPath = path.join(buildRoot, 'contact-sheet.html');
    fs.writeFileSync(sheetPath, renderContactSheet(rendered.map(poster => ({
      index: poster.index,
      label: labels[poster.id] || poster.id,
      url: pathToFileURL(path.join(outputRoot, poster.file)).href,
    })), campaign), 'utf8');

    win.setContentSize(SHEET_W / SCALE, SHEET_H / SCALE);
    await win.loadFile(sheetPath);
    assert.equal(await win.webContents.executeJavaScript(SETTLED), true, 'contact sheet: image failed to decode');
    await new Promise(resolve => setTimeout(resolve, 600));
    const sheet = (await win.webContents.capturePage()).toPNG({ scaleFactor: SCALE });
    assert.equal(sheet.readUInt32BE(16), SHEET_W, 'contact sheet width');
    assert.equal(sheet.readUInt32BE(20), SHEET_H, 'contact sheet height');
    fs.writeFileSync(path.join(outputRoot, 'contact-sheet.png'), sheet);
    console.log(`CONTACT_SHEET_OK ${SHEET_W}x${SHEET_H} ${sheet.length} bytes`);

    fs.writeFileSync(path.join(outputRoot, 'MANIFEST.json'), `${JSON.stringify({
      campaign: `${campaign.title} · ${campaign.latin}`,
      build: campaign.build,
      canvas: `${WIDTH}x${HEIGHT}`,
      generated: new Date().toISOString(),
      note: 'Runtime captures are placed unmodified; only scale and rounded corners are applied by the poster frame.',
      posters: rendered,
    }, null, 2)}\n`, 'utf8');
  }

  console.log(`POSTER_SET_OK count=${rendered.length}`);
  win.destroy();
  app.quit();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
