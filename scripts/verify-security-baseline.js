const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/app/main.ts'), 'utf8');
const ipcSource = fs.readFileSync(path.join(root, 'src/app/ipc/index.ts'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const viteSource = fs.readFileSync(path.join(root, 'vite.config.mts'), 'utf8');
const builderSource = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
const { cleanAttachmentIds, cleanChatPayload, cleanExistingFilePath, isTrustedIpcSender, MAX_CHAT_CHARS } = require('../dist/app/ipc/validation');
const { buildToolConfirmation, buildToolArgumentPreview } = require('../dist/core/tools/ToolRuntime');
const { DEFAULT_SETTINGS, getSettingsBundle, saveSettingsBundle } = require('../dist/core/config/SettingsStore');
const permissionGate = require('../dist/app/security/PermissionGate');

assert.match(mainSource, /sandbox:\s*true/);
assert.match(mainSource, /contextIsolation:\s*true/);
assert.match(mainSource, /nodeIntegration:\s*false/);
assert.match(mainSource, /will-download[\s\S]{0,100}preventDefault/);
assert.match(mainSource, /setWindowOpenHandler[\s\S]{0,200}action:\s*'deny'/);
assert.match(mainSource, /will-navigate[\s\S]{0,200}preventDefault/);
assert.match(mainSource, /confirmExternalOpen/);
assert.match(mainSource, /url\.protocol === 'https:'/);
assert.match(htmlSource, /Content-Security-Policy/);
assert.doesNotMatch(htmlSource, /unsafe-eval|unsafe-inline/);
assert.match(viteSource, /sourcemap:\s*false/);
assert.match(builderSource, /!\*\*\/\*\.map/);
assert.match(builderSource, /!\*\*\/\*\.d\.ts/);
assert.match(builderSource, /!config\/settings\.json/);
assert.equal(tsconfig.compilerOptions.sourceMap, false);
assert.equal(DEFAULT_SETTINGS.tools.permissionLevel, 'off');
assert.equal(DEFAULT_SETTINGS.tools.modePermissions.execute, 'off');
const trackedSettings = JSON.parse(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'));
assert.equal(trackedSettings.tools.permissionLevel, 'off');
assert.equal(trackedSettings.tools.modePermissions.create, 'off');
assert.equal(trackedSettings.tools.modePermissions.companion, 'off');
assert.equal(trackedSettings.tools.modePermissions.reason, 'off');
assert.equal(trackedSettings.tools.modePermissions.execute, 'off');
assert.equal(trackedSettings.privacy.networkConsent.remoteModel, false);
assert.equal(trackedSettings.privacy.networkConsent.webSearch, false);
assert.equal(trackedSettings.privacy.networkConsent.imageGeneration, false);
assert.equal(trackedSettings.privacy.networkConsent.onlineSpeechToText, false);
assert.equal(trackedSettings.privacy.networkConsent.onlineTextToSpeech, false);
assert.equal(trackedSettings.privacy.networkConsent.externalToolNetwork, false);
const conversationSource = fs.readFileSync(path.join(root, 'src/core/ai/Conversation.ts'), 'utf8');
assert.match(conversationSource, /execute:\s*'off'/);
assert.doesNotMatch(conversationSource, /execute:\s*'full'/);
assert.match(builderSource, /!config\/settings\.local\.json/);
assert.match(builderSource, /!config\/model\.local\.json/);
const trackedModel = JSON.parse(fs.readFileSync(path.join(root, 'config/model.json'), 'utf8'));
assert.equal(trackedModel.provider, 'ollama');
assert.equal(trackedModel.setupComplete, false);
const handlerNames = [...ipcSource.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]);
const untrustedHandlers = handlerNames.filter(name => {
  const block = ipcSource.match(new RegExp(`ipcMain\\.handle\\('${name}'[\\s\\S]{0,400}`));
  return !block || !/if \(!isTrustedSender\(event\)\)/.test(block[0]);
});
assert.deepEqual(untrustedHandlers, [], `invoke handlers missing a standalone trusted-sender check: ${untrustedHandlers.join(', ')}`);
assert.equal(
  [...ipcSource.matchAll(/if \(!isTrustedSender\(event\)\)/g)].length,
  handlerNames.length,
  'every invoke handler must reject an untrusted sender',
);

const webContents = {};
const window = { isDestroyed: () => false, webContents };
assert.equal(isTrustedIpcSender({ sender: webContents }, window), true);
assert.equal(isTrustedIpcSender({ sender: {} }, window), false);
assert.equal(isTrustedIpcSender({ sender: webContents }, { ...window, isDestroyed: () => true }), false);
assert.equal(cleanChatPayload(null, 'companion'), null);
assert.equal(cleanChatPayload({ text: 42 }, 'companion'), null);
const cleaned = cleanChatPayload({ text: 'x'.repeat(MAX_CHAT_CHARS + 10), mode: 'bogus', forceWebSearch: 'yes' }, 'reason');
assert.equal(cleaned.text.length, MAX_CHAT_CHARS);
assert.equal(cleaned.mode, 'reason');
assert.equal(cleaned.forceWebSearch, false);
assert.deepEqual(cleanAttachmentIds([
  'c56a4180-65aa-42ec-a945-5fd21dec0538',
  'c56a4180-65aa-42ec-a945-5fd21dec0538',
  '..\\escape.png',
  42,
]), ['c56a4180-65aa-42ec-a945-5fd21dec0538']);
assert.deepEqual(cleanChatPayload({
  text: 'image',
  attachmentIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538', 'invalid'],
}, 'companion').attachmentIds, ['c56a4180-65aa-42ec-a945-5fd21dec0538']);
permissionGate.revokeMicrophoneGrant();
assert.equal(permissionGate.hasMicrophoneGrant(), false);
permissionGate.armMicrophoneGrant();
assert.equal(permissionGate.hasMicrophoneGrant(), true);
assert.equal(permissionGate.consumeMicrophoneGrant(), true);
assert.equal(permissionGate.consumeMicrophoneGrant(), false);
const tempJson = path.join(root, 'scripts', '.security-path-probe.json');
fs.writeFileSync(tempJson, '{}');
try {
  assert.equal(cleanExistingFilePath(tempJson, ['json']), tempJson);
  assert.equal(cleanExistingFilePath(tempJson, ['wav']), null);
  assert.equal(cleanExistingFilePath(path.join(root, 'missing.json'), ['json']), null);
  assert.equal(cleanExistingFilePath(42, ['json']), null);
} finally {
  fs.rmSync(tempJson, { force: true });
}

for (const [name, args] of [
  ['delete_path', { path: 'C:\\temp\\x' }],
  ['write_file', { path: 'C:\\temp\\x', mode: 'overwrite', content: 'secret' }],
  ['move_path', { source: 'a', destination: 'b' }],
  ['run_command', { command: 'Remove-Item x' }],
  ['terminal_start', { shell: 'powershell' }],
  ['launch_program', { program: 'powershell.exe' }],
  ['open_path', { path: 'C:\\temp\\x.txt' }],
  ['http_request', { url: 'https://example.com' }],
  ['check_port', { host: 'example.com', port: 443 }],
]) {
  assert.ok(buildToolConfirmation(name, name, args), `${name} must require confirmation`);
}
assert.equal(buildToolConfirmation('read_file', 'read', { path: 'x' }), null);
assert.equal(buildToolConfirmation('http_request', 'http', { url: 'http://127.0.0.1:11434/api/tags' }), null);
assert.equal(buildToolConfirmation('check_port', 'port', { host: 'localhost', port: 11434 }), null);
assert.doesNotMatch(buildToolArgumentPreview({ authorization: 'Bearer secret', apiKey: 'sk-proj-secret' }), /Bearer secret|sk-proj-secret/);

const overlayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-overlay-'));
const previousConfigDir = process.env.ATHENA_CONFIG_DIR;
const previousLocalSettings = process.env.ATHENA_USE_LOCAL_SETTINGS;
try {
  process.env.ATHENA_CONFIG_DIR = path.join(overlayRoot, 'config');
  delete process.env.ATHENA_USE_LOCAL_SETTINGS;
  fs.mkdirSync(process.env.ATHENA_CONFIG_DIR, { recursive: true });
  let bundle = getSettingsBundle();
  assert.equal(bundle.settings.tools.modePermissions.execute, 'off');
  assert.equal(bundle.model.provider, 'ollama');
  assert.equal(bundle.model.setupComplete, false);

  process.env.ATHENA_USE_LOCAL_SETTINGS = '1';
  bundle = saveSettingsBundle({
    settings: {
      tools: { modePermissions: { execute: 'full' } },
      privacy: { networkConsent: { remoteModel: true, webSearch: true, externalToolNetwork: true } },
    },
    model: { provider: 'deepseek', setupComplete: true },
  });
  assert.equal(bundle.settings.tools.modePermissions.execute, 'full');
  assert.equal(bundle.model.provider, 'deepseek');
  assert.equal(fs.existsSync(path.join(process.env.ATHENA_CONFIG_DIR, 'settings.local.json')), true);
  assert.equal(fs.existsSync(path.join(process.env.ATHENA_CONFIG_DIR, 'model.local.json')), true);
  assert.equal(fs.existsSync(path.join(process.env.ATHENA_CONFIG_DIR, 'settings.json')), false);

  delete process.env.ATHENA_USE_LOCAL_SETTINGS;
  bundle = getSettingsBundle();
  assert.equal(bundle.settings.tools.modePermissions.execute, 'off');
  assert.equal(bundle.settings.privacy.networkConsent.remoteModel, false);
  assert.equal(bundle.model.provider, 'ollama');
  assert.equal(bundle.model.setupComplete, false);
} finally {
  if (previousConfigDir === undefined) delete process.env.ATHENA_CONFIG_DIR;
  else process.env.ATHENA_CONFIG_DIR = previousConfigDir;
  if (previousLocalSettings === undefined) delete process.env.ATHENA_USE_LOCAL_SETTINGS;
  else process.env.ATHENA_USE_LOCAL_SETTINGS = previousLocalSettings;
  fs.rmSync(overlayRoot, { recursive: true, force: true });
}

console.log('SECURITY_BASELINE_OK');
