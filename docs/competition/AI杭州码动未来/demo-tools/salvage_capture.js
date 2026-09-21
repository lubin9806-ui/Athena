'use strict';

const fs = require('node:fs');
const path = require('node:path');

const inputDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!inputDir || !fs.existsSync(path.join(inputDir, 'frames'))) {
  throw new Error('Usage: node salvage_capture.js <capture-directory>');
}

const files = fs.readdirSync(path.join(inputDir, 'frames'))
  .filter(name => /^frame-\d+\.jpg$/i.test(name))
  .sort();
if (!files.length) throw new Error('No screencast frames found');

const details = files.map(file => {
  const stat = fs.statSync(path.join(inputDir, 'frames', file));
  return { file, timeMs: stat.mtimeMs };
});
const start = details[0].timeMs;
const frames = details.map(item => ({
  file: item.file,
  relativeMs: Math.max(0, Math.round(item.timeMs - start)),
}));
const runLog = path.join(inputDir, 'run.log');
const logText = fs.existsSync(runLog) ? fs.readFileSync(runLog, 'utf8') : '';
const manifest = {
  capturedAt: new Date(start).toISOString(),
  scenario: 'live-fix-failing-tests',
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  source: 'Chromium Page.startScreencast from the real Athena renderer',
  timelineSource: 'frame filesystem mtime recovered after recorder shutdown race',
  childExitCode: /ATHENA_EXECUTE_E2E_OK/.test(logText) ? 0 : null,
  frameCount: frames.length,
  durationMs: frames.at(-1).relativeMs,
  frames,
};
fs.writeFileSync(path.join(inputDir, 'capture.json'), JSON.stringify(manifest, null, 2));
console.log(`ATHENA_DEMO_CAPTURE_RECOVERED ${JSON.stringify({ inputDir, frameCount: frames.length, durationMs: manifest.durationMs, childExitCode: manifest.childExitCode })}`);
