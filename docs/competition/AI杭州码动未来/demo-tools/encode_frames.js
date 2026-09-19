'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const inputDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
const fps = Number(process.argv[3] || 15);

async function encode(window, config) {
  return window.webContents.executeJavaScript(`(async () => {
    const config = ${JSON.stringify(config)};
    const fs = require('node:fs');
    const path = require('node:path');
    const manifest = JSON.parse(fs.readFileSync(path.join(config.inputDir, 'capture.json'), 'utf8'));
    if (!manifest.frames.length) throw new Error('capture has no frames');

    const candidates = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Chromium MediaRecorder exposes no supported video type');

    const loadImage = file => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('failed to load ' + file));
      image.src = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    });
    const images = [];
    for (const frame of manifest.frames) {
      images.push(await loadImage(path.join(config.inputDir, 'frames', frame.file)));
    }

    const canvas = document.createElement('canvas');
    canvas.width = images[0].naturalWidth;
    canvas.height = images[0].naturalHeight;
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(images[0], 0, 0, canvas.width, canvas.height);

    const stream = canvas.captureStream(config.fps);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
    });
    recorder.start(1000);

    const interval = 1000 / config.fps;
    const durationMs = Math.max(manifest.durationMs + 1000, interval);
    let frameIndex = 0;
    for (let time = 0; time <= durationMs; time += interval) {
      while (frameIndex + 1 < manifest.frames.length && manifest.frames[frameIndex + 1].relativeMs <= time) {
        frameIndex += 1;
      }
      context.drawImage(images[frameIndex], 0, 0, canvas.width, canvas.height);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mimeType });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const extension = mimeType.startsWith('video/mp4') ? '.mp4' : '.webm';
    const output = path.join(config.inputDir, 'Athena_Demo_无剪辑证据版' + extension);
    fs.writeFileSync(output, bytes);
    return { output, mimeType, bytes: bytes.length, width: canvas.width, height: canvas.height, durationMs };
  })()`);
}

app.whenReady().then(async () => {
  if (!inputDir || !fs.existsSync(path.join(inputDir, 'capture.json'))) {
    throw new Error('Usage: electron encode_frames.js <capture-directory> [fps]');
  }
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  await window.loadURL('data:text/html,<meta charset="utf-8"><body style="margin:0;background:black"></body>');
  const result = await encode(window, { inputDir, fps });
  console.log(`ATHENA_DEMO_VIDEO ${JSON.stringify(result)}`);
  await window.close();
  app.quit();
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
