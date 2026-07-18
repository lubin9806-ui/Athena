const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function resolveGit() {
  const candidates = [
    process.env.ATHENA_GIT_PATH,
    'git',
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Git\\cmd\\git.exe' : null,
    process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'git', 'cmd', 'git.exe')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const GIT = resolveGit();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function packageMetadata() {
  return readJson(path.join(ROOT, 'package.json'));
}

function releaseChannel(version = packageMetadata().version) {
  if (/^\d+\.\d+\.\d+$/.test(version)) return 'stable';
  if (/^\d+\.\d+\.\d+-(?:beta|rc)\.\d+$/.test(version)) return 'beta';
  throw new Error(`Unsupported release version: ${version}. Use x.y.z or x.y.z-beta.N.`);
}

function git(args, fallback = '') {
  if (!GIT) return fallback;
  const result = spawnSync(GIT, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function sourceState() {
  const commit = process.env.ATHENA_BUILD_COMMIT
    || process.env.GITHUB_SHA
    || git(['rev-parse', 'HEAD'], 'unknown');
  const changes = git(['status', '--porcelain=v1', '--untracked-files=all'])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(line => !/^.. (?:release|dist|\.build)[\\/]/.test(line));
  return {
    commit,
    shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 12),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    cleanCheckout: commit !== 'unknown' && GIT !== null && changes.length === 0,
    changedPathCount: changes.length,
    gitAvailable: GIT !== null,
  };
}

function walkFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
  }
  return files;
}

function buildInputHash() {
  const roots = [
    'src', 'scripts', 'config', 'skills', 'resources',
    'package.json', 'package-lock.json', 'electron-builder.yml',
    'tsconfig.json', 'vite.config.mts', 'requirements-voice.txt',
    'tts.py', 'stt.py', 'stt_whisper.py', 'play_audio.py',
  ];
  const files = [];
  for (const relative of roots) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).isDirectory()) {
      files.push(...walkFiles(absolute, relative.replace(/\\/g, '/')));
    } else {
      files.push({ absolute, relative: relative.replace(/\\/g, '/') });
    }
  }
  const hash = crypto.createHash('sha256');
  for (const file of files.sort((left, right) => left.relative.localeCompare(right.relative))) {
    hash.update(file.relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file.absolute));
    hash.update('\0');
  }
  return hash.digest('hex').toUpperCase();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function signingCredentialsPresent() {
  const certificate = process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.WINDOWS_CSC_LINK;
  const password = process.env.CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD || process.env.WINDOWS_CSC_KEY_PASSWORD;
  return Boolean(certificate && password);
}

function authenticode(filePath) {
  if (process.platform !== 'win32') {
    return { status: 'PlatformUnsupported', valid: false, subject: null, thumbprint: null, timestampSubject: null };
  }
  const literal = filePath.replace(/'/g, "''");
  const command = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $signature = Get-AuthenticodeSignature -LiteralPath '${literal}'; [pscustomobject]@{ Status = [string]$signature.Status; StatusMessage = [string]$signature.StatusMessage; Subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }; Thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }; TimestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null } } | ConvertTo-Json -Compress`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { status: 'InspectionFailed', valid: false, subject: null, thumbprint: null, timestampSubject: null };
  }
  const parsed = JSON.parse(result.stdout.trim());
  return {
    status: parsed.Status,
    statusMessage: parsed.StatusMessage,
    valid: parsed.Status === 'Valid',
    subject: parsed.Subject || null,
    thumbprint: parsed.Thumbprint || null,
    timestampSubject: parsed.TimestampSubject || null,
  };
}

function buildTime() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  return Number.isFinite(epoch) && epoch > 0
    ? new Date(epoch * 1000).toISOString()
    : new Date().toISOString();
}

module.exports = {
  ROOT,
  authenticode,
  buildInputHash,
  buildTime,
  packageMetadata,
  readJson,
  releaseChannel,
  sha256,
  sha512Base64,
  signingCredentialsPresent,
  sourceState,
  writeJson,
};
