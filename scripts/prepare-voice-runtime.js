const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'resources', 'voice-runtime');
const CACHE = path.join(ROOT, '.build', 'voice-cache');
const PYTHON_ARCHIVE = path.join(CACHE, 'python-3.11.9-embed-amd64.zip');
const PYTHON_URL = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip';
const PYTHON_SHA256 = '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b';
const MODEL_REPOSITORY = 'Systran/faster-whisper-tiny';
const MODEL_REVISION = 'd90ca5fe260221311c53c58e660288d3deb8d356';
const MODEL_FILES = ['README.md', 'config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'];

function assertInsideWorkspace(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Refusing path outside workspace: ${resolved}`);
  return resolved;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
    ...options,
  });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function download(url, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  run('curl.exe', ['-L', '--fail', '--retry', '3', '--continue-at', '-', '--output', target, url]);
}

function verifyHash(filePath, expected) {
  const actual = sha256(filePath);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${path.basename(filePath)}: ${actual}`);
}

function copyRuntimeInputs() {
  const files = [
    'stt_whisper.py',
    'tts-local.ps1',
    'tts-capabilities.ps1',
    'play_audio_local.ps1',
    'requirements-voice.txt',
    'requirements-voice.lock.txt',
  ];
  for (const name of files) fs.copyFileSync(path.join(ROOT, name), path.join(OUTPUT, name));
}

function removeGeneratedBytecode(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) {
      removeGeneratedBytecode(absolute);
      if (item.name === '__pycache__' && fs.existsSync(absolute)) fs.rmSync(absolute, { recursive: true, force: true });
    } else if (item.isFile() && item.name.endsWith('.pyc')) {
      fs.unlinkSync(absolute);
    }
  }
}

function writeManifest() {
  const entries = [];
  const visit = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) visit(absolute);
      else if (item.isFile() && item.name !== 'voice-runtime-manifest.json') {
        entries.push({
          path: path.relative(OUTPUT, absolute).replace(/\\/g, '/'),
          bytes: fs.statSync(absolute).size,
          sha256: sha256(absolute),
        });
      }
    }
  };
  visit(OUTPUT);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: 1,
    architecture: 'windows-x64',
    python: { version: '3.11.9', source: PYTHON_URL, archiveSha256: PYTHON_SHA256 },
    whisper: {
      implementation: 'faster-whisper',
      modelRepository: MODEL_REPOSITORY,
      modelRevision: MODEL_REVISION,
      modelLicense: 'MIT',
    },
    files: entries,
  };
  fs.writeFileSync(path.join(OUTPUT, 'voice-runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function main() {
  assertInsideWorkspace(OUTPUT);
  assertInsideWorkspace(CACHE);
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(PYTHON_ARCHIVE) || sha256(PYTHON_ARCHIVE) !== PYTHON_SHA256) {
    download(PYTHON_URL, PYTHON_ARCHIVE);
  }
  verifyHash(PYTHON_ARCHIVE, PYTHON_SHA256);

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const pythonDir = path.join(OUTPUT, 'python');
  fs.mkdirSync(pythonDir, { recursive: true });
  run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'scripts', 'expand-archive.ps1'), '-Archive', PYTHON_ARCHIVE, '-Destination', pythonDir,
  ]);

  const pthPath = path.join(pythonDir, 'python311._pth');
  let pth = fs.readFileSync(pthPath, 'utf8');
  pth = pth.replace(/^#import site$/m, 'Lib\\site-packages\nimport site');
  fs.writeFileSync(pthPath, pth, 'utf8');

  const sitePackages = path.join(pythonDir, 'Lib', 'site-packages');
  fs.mkdirSync(sitePackages, { recursive: true });
  run('python', [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--only-binary=:all:',
    '--target', sitePackages, '--requirement', path.join(ROOT, 'requirements-voice.lock.txt'),
  ]);

  const modelDir = path.join(OUTPUT, 'models', 'whisper-tiny');
  fs.mkdirSync(modelDir, { recursive: true });
  for (const name of MODEL_FILES) {
    const url = `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${name}?download=true`;
    download(url, path.join(modelDir, name));
  }

  copyRuntimeInputs();
  removeGeneratedBytecode(OUTPUT);
  const manifest = writeManifest();
  console.log(`ATHENA_VOICE_RUNTIME_PREPARED files=${manifest.files.length} bytes=${manifest.files.reduce((sum, file) => sum + file.bytes, 0)}`);
}

main();
