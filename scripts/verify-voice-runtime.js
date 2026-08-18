const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const runtimeRoot = path.resolve(process.env.ATHENA_VOICE_RUNTIME_DIR || path.join(ROOT, 'resources', 'voice-runtime'));
const manifestPath = path.join(runtimeRoot, 'voice-runtime-manifest.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: runtimeRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
    },
    ...options,
  });
}

function findExecutables(directory) {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...findExecutables(absolute));
    else if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) files.push(absolute);
  }
  return files;
}

function main() {
  assert(fs.existsSync(manifestPath), 'Managed voice runtime is missing. Run npm.cmd run prepare:voice-runtime.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.architecture, 'windows-x64');
  for (const entry of manifest.files) {
    const filePath = path.resolve(runtimeRoot, entry.path);
    assert(filePath.startsWith(`${runtimeRoot}${path.sep}`), `Manifest path escaped runtime: ${entry.path}`);
    assert(fs.existsSync(filePath), `Voice runtime file missing: ${entry.path}`);
    assert.strictEqual(fs.statSync(filePath).size, entry.bytes, `Voice runtime size mismatch: ${entry.path}`);
    assert.strictEqual(sha256(filePath), entry.sha256, `Voice runtime hash mismatch: ${entry.path}`);
  }

  const python = path.join(runtimeRoot, 'python', 'python.exe');
  assert.deepStrictEqual(
    findExecutables(runtimeRoot).map(file => path.relative(runtimeRoot, file).replace(/\\/g, '/')).sort(),
    ['python/python.exe'],
    'Managed voice runtime must not ship unused executable launchers.',
  );
  const importProbe = run(python, ['-c', 'import faster_whisper,av,numpy; print(faster_whisper.__version__,av.__version__,numpy.__version__)']);
  assert.strictEqual(importProbe.status, 0, importProbe.stderr || importProbe.stdout);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-voice-runtime-'));
  try {
    const textPath = path.join(scratch, 'probe.txt');
    const wavPath = path.join(scratch, 'probe.wav');
    fs.writeFileSync(textPath, 'Athena voice output test.', 'utf8');
    const ttsProbe = run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(runtimeRoot, 'tts-local.ps1'), '-TextFile', textPath, '-OutputFile', wavPath,
    ]);
    assert.strictEqual(ttsProbe.status, 0, ttsProbe.stderr || ttsProbe.stdout);
    assert(fs.existsSync(wavPath) && fs.statSync(wavPath).size > 44, 'Windows SAPI did not generate a valid WAV file.');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`ATHENA_VOICE_RUNTIME_OK files=${manifest.files.length} imports=${importProbe.stdout.trim()}`);
}

main();
