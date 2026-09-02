const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app, safeStorage } = require('electron');

async function main() {
  await app.whenReady();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-model-providers-'));
  const originalCwd = process.cwd();
  process.env.ATHENA_CREDENTIALS_DIR = path.join(scratch, 'credentials');
  process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ url: request.url, authorization: request.headers.authorization || '', body });
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"data":[{"id":"fixture-model"}]}');
      return;
    }
    const payload = body ? JSON.parse(body) : {};
    if (payload.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"fixture"}}]}\n\n');
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: payload.response_format ? '{"ok":true}' : 'fixture-response' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    const credentials = require('../dist/core/ai/CredentialStore.js');
    const { LLMClient } = require('../dist/core/ai/Client.js');
    const { diagnoseModelConnection, friendlyModelConnectionError } = require('../dist/core/ai/ModelConnectionDiagnostics.js');
    const { canRouteModelRequest } = require('../dist/core/ai/ModelNetworkPolicy.js');
    const { saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');

    assert.strictEqual(safeStorage.isEncryptionAvailable(), true, 'Windows safeStorage must be available');
    const stored = credentials.setModelCredential('openai', 'sk-athena-provider-fixture');
    assert.strictEqual(stored.configured, true);
    assert.strictEqual(stored.source, 'windows-safe-storage');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-athena-provider-fixture');
    const credentialFile = path.join(process.env.ATHENA_CREDENTIALS_DIR, 'model-credentials.enc.json');
    assert(fs.existsSync(credentialFile));
    assert(!fs.readFileSync(credentialFile, 'utf8').includes('sk-athena-provider-fixture'));
    fs.writeFileSync(path.join(scratch, '.env'), 'OPENAI_API_KEY=sk-stale-local-file\n', 'utf8');
    process.chdir(scratch);
    assert.strictEqual(credentials.getModelCredentialStatus('openai').source, 'windows-safe-storage');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-athena-provider-fixture');
    process.env.OPENAI_API_KEY = 'sk-explicit-process-environment';
    assert.strictEqual(credentials.getModelCredentialStatus('openai').source, 'environment');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-explicit-process-environment');
    delete process.env.OPENAI_API_KEY;

    const bundle = saveSettingsBundle({ model: {
      provider: 'openai',
      setupComplete: true,
      remote: { openai: { baseUrl, model: 'fixture-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    } });
    assert.strictEqual(bundle.model.provider, 'openai');
    assert.strictEqual(bundle.model.remote.openai.baseUrl, baseUrl);
    assert(!JSON.stringify(bundle.model).toLowerCase().includes('apikey'));

    const deepseekDefaults = new LLMClient({ provider: 'deepseek' }, () => null);
    assert.strictEqual(deepseekDefaults.endpoint, '');
    assert.strictEqual(deepseekDefaults.modelName, '');
    assert.strictEqual(canRouteModelRequest('ollama', false), true);
    assert.strictEqual(canRouteModelRequest('openai', false), false);
    assert.strictEqual(canRouteModelRequest('deepseek', false), false);
    assert.strictEqual(canRouteModelRequest('deepseek', true), true);

    const normalized = saveSettingsBundle({ model: {
      remote: {
        openai: { baseUrl: 'https://api.openai.com/chat/completions', model: 'gpt-test' },
        deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-test' },
      },
    } });
    assert.strictEqual(normalized.model.remote.openai.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(normalized.model.remote.deepseek.baseUrl, 'https://api.deepseek.com');
    const deepseekBeta = saveSettingsBundle({ model: {
      remote: { deepseek: { baseUrl: 'https://api.deepseek.com/beta' } },
    } });
    assert.strictEqual(deepseekBeta.model.remote.deepseek.baseUrl, 'https://api.deepseek.com/beta');

    const client = new LLMClient(bundle.model, () => 'sk-athena-provider-fixture');
    assert.strictEqual(await client.checkConnection(), true);
    assert.deepStrictEqual(await client.listModels(), ['fixture-model']);
    assert.strictEqual(await client.chat([{ role: 'user', content: 'hello' }]), 'fixture-response');
    let streamed = '';
    assert.strictEqual(await client.chat([{ role: 'user', content: 'stream' }], chunk => { streamed += chunk; }), 'fixture');
    assert.strictEqual(streamed, 'fixture');
    assert.strictEqual(await client.chatJson([{ role: 'user', content: 'json' }], { type: 'object' }), '{"ok":true}');
    const diagnostic = await diagnoseModelConnection(client);
    assert.strictEqual(diagnostic.connected, true);
    const emptyModelClient = new LLMClient({
      ...bundle.model,
      remote: { ...bundle.model.remote, openai: { ...bundle.model.remote.openai, model: '' } },
    }, () => 'sk-athena-provider-fixture');
    const emptyModelDiagnostic = await diagnoseModelConnection(emptyModelClient);
    assert.strictEqual(emptyModelDiagnostic.serviceReachable, true);
    assert.strictEqual(emptyModelDiagnostic.modelAvailable, false);
    assert.match(emptyModelDiagnostic.error, /尚未选择模型/);
    assert.match(friendlyModelConnectionError(new Error('DeepSeek request failed: 401 Unauthorized')), /API Key 无效/);
    assert(requests.some(item => item.url === '/v1/models'));
    assert(requests.filter(item => item.url === '/v1/chat/completions').every(item => item.authorization === 'Bearer sk-athena-provider-fixture'));

    const custom = new LLMClient({
      provider: 'custom',
      remote: { custom: { baseUrl, model: 'fixture-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    }, () => null);
    assert.deepStrictEqual(await custom.listModels(), ['fixture-model']);
    assert.strictEqual(await custom.chat([{ role: 'user', content: 'custom' }]), 'fixture-response');

    const cleared = credentials.clearModelCredential('openai');
    assert.strictEqual(cleared.configured, true);
    assert.strictEqual(cleared.source, 'local-env-file');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-stale-local-file');
    fs.rmSync(path.join(scratch, '.env'));
    assert.strictEqual(credentials.getModelCredentialStatus('openai').configured, false);
    assert.strictEqual(credentials.resolveModelCredential('openai'), null);
    console.log('ATHENA_MODEL_PROVIDERS_OK providers=ollama+openai+deepseek+athena-cloud+custom credentials=encrypted');
  } finally {
    process.chdir(originalCwd);
    delete process.env.OPENAI_API_KEY;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
