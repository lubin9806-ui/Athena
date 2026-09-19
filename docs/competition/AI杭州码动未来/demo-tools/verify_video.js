'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const video = process.argv[2] ? path.resolve(process.argv[2]) : '';
const outputDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(path.dirname(video), 'video-qa');

function waitForEvent(window, name) {
  return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const video = document.getElementById('video');
    if (${JSON.stringify(name)} === 'loadedmetadata' && video.readyState >= 1) return resolve(true);
    video.addEventListener(${JSON.stringify(name)}, () => resolve(true), { once: true });
    video.addEventListener('error', () => reject(new Error(video.error?.message || 'video decode error')), { once: true });
  })`);
}

app.whenReady().then(async () => {
  if (!video || !fs.existsSync(video)) throw new Error('Usage: electron verify_video.js <video> [output-directory]');
  fs.mkdirSync(outputDir, { recursive: true });
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { autoplayPolicy: 'no-user-gesture-required' } });
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}video{width:1920px;height:1080px;object-fit:contain}</style><video id="video" muted preload="auto" src="${pathToFileURL(video).href}"></video>`;
  const htmlFile = path.join(outputDir, 'qa-player.html');
  fs.writeFileSync(htmlFile, html);
  await window.loadFile(htmlFile);
  await Promise.race([
    waitForEvent(window, 'loadedmetadata'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('video metadata timed out')), 15_000)),
  ]);
  const metadata = await window.webContents.executeJavaScript(`(() => { const v=document.getElementById('video'); return { duration:v.duration, videoWidth:v.videoWidth, videoHeight:v.videoHeight, readyState:v.readyState }; })()`);
  const points = [1, 10, 25, 60, 92, 108, 120, 140].filter(value => value < metadata.duration);
  for (const second of points) {
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const video=document.getElementById('video');
      const done=()=>resolve(true);
      video.addEventListener('seeked', done, { once:true });
      video.addEventListener('error', ()=>reject(new Error('seek failed')), { once:true });
      video.currentTime=${second};
    })`);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, `at-${String(second).padStart(3, '0')}s.png`), image.toPNG());
  }
  console.log(`ATHENA_VIDEO_QA ${JSON.stringify({ video, outputDir, ...metadata, screenshots: points.length })}`);
  fs.rmSync(htmlFile, { force: true });
  await window.close();
  app.quit();
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
