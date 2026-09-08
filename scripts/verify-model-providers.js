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
  process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
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

    const encryptedCredentialFile = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
    encryptedCredentialFile.entries.openai = 'not-a-readable-safe-storage-payload';
    fs.writeFileSync(credentialFile, `${JSON.stringify(encryptedCredentialFile, null, 2)}\n`, 'utf8');
    const unreadableStatus = credentials.getModelCredentialStatus('openai');
    assert.strictEqual(unreadableStatus.configured, false, 'an unreadable encrypted credential must not be reported as configured');
    assert.strictEqual(unreadableStatus.source, 'windows-safe-storage');
    assert.strictEqual(unreadableStatus.error, 'credential.decrypt_failed');
    assert.throws(
      () => credentials.resolveModelCredential('openai'),
      error => error?.code === 'credential.decrypt_failed' && /未改用其他凭据来源/.test(error.message),
      'an unreadable encrypted credential must fail closed instead of falling back to .env',
    );
    credentials.setModelCredential('openai', 'sk-athena-provider-fixture');

    process.env.OPENAI_API_KEY = 'sk-explicit-process-environment';
    assert.strictEqual(credentials.getModelCredentialStatus('openai').source, 'environment');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-explicit-process-environment');
    delete process.env.OPENAI_API_KEY;

    const bundle = saveSettingsBundle({ model: {
      provider: 'openai',
      setupComplete: true,
      assistModel: 'fixture-assist-model',
      remote: { openai: { baseUrl, model: 'fixture-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    } });
    assert.strictEqual(bundle.model.provider, 'openai');
    assert.strictEqual(bundle.model.remote.openai.baseUrl, baseUrl);
    assert.strictEqual(bundle.model.assistModel, 'fixture-assist-model');
    assert(!JSON.stringify(bundle.model).toLowerCase().includes('apikey'));

    const { createAssistModelClient } = require('../dist/core/ai/Client.js');
    const mainClient = new LLMClient();
    const assistClient = createAssistModelClient(mainClient);
    assert.notStrictEqual(assistClient, mainClient, 'configured assist model should get its own client');
    assert.strictEqual(assistClient.providerName, 'openai');
    assert.strictEqual(assistClient.modelName, 'fixture-assist-model');
    assert.strictEqual(assistClient.endpoint, baseUrl);

    const { AthenaController } = require('../dist/core/controller/AthenaController.js');
    const controller = new AthenaController();
    await controller.initialize();
    const routed = await controller.routeMessage('这个配色你怎么看', 'companion');
    assert.match(routed.routingTicket, /^[0-9a-f-]{36}$/i);
    assert(Number.isInteger(routed.routingDurationMs) && routed.routingDurationMs >= 0);
    const consumed = await controller.consumeRouteMessage('这个配色你怎么看', 'companion', {
      routingTicket: routed.routingTicket,
    });
    assert.strictEqual(consumed.routingTicket, routed.routingTicket, 'an exact route ticket must be consumed without re-routing');
    const replayed = await controller.consumeRouteMessage('这个配色你怎么看', 'companion', {
      routingTicket: routed.routingTicket,
    });
    assert.notStrictEqual(replayed.routingTicket, routed.routingTicket, 'a route ticket must be one-use');
    await controller.shutdown();

    const deepseekDefaults = new LLMClient({ provider: 'deepseek' }, () => null);
    assert.strictEqual(deepseekDefaults.endpoint, '');
    assert.strictEqual(deepseekDefaults.modelName, '');
    assert.strictEqual(canRouteModelRequest('ollama', false), true);
    assert.strictEqual(canRouteModelRequest('openai', false), false);
    assert.strictEqual(canRouteModelRequest('deepseek', false), false);
    assert.strictEqual(canRouteModelRequest('deepseek', true), true);

    // ATH-SEC-006: the provider name is not a destination. An Ollama base URL can
    // point at another machine, and the conversation leaves this device either way.
    const { classifyModelEndpoint } = require('../dist/core/ai/ModelNetworkPolicy.js');
    for (const [endpoint, expected] of [
      ['http://127.0.0.1:11434', 'loopback'],
      ['http://localhost:11434', 'loopback'],
      ['http://[::1]:11434', 'loopback'],
      ['http://ollama.localhost:11434', 'loopback'],
      ['http://192.168.1.50:11434', 'private-network'],
      ['http://10.0.0.9:11434', 'private-network'],
      ['http://172.20.3.4:11434', 'private-network'],
      ['http://nas.local:11434', 'private-network'],
      ['https://models.example.com', 'remote'],
      ['http://203.0.113.10:11434', 'remote'],
      ['', 'unknown'],
      ['not a url at all', 'unknown'],
    ]) {
      assert.strictEqual(classifyModelEndpoint(endpoint), expected, `endpoint scope for ${endpoint || '<empty>'}`);
    }
    // An address that cannot be parsed is not assumed local.
    assert.strictEqual(canRouteModelRequest('ollama', false, 'not a url at all'), false);

    assert.strictEqual(canRouteModelRequest('ollama', false, 'http://127.0.0.1:11434'), true, 'loopback needs no consent');
    assert.strictEqual(
      canRouteModelRequest('ollama', false, 'http://192.168.1.50:11434'), false,
      'an Ollama server on the LAN still sends the conversation off this device',
    );
    assert.strictEqual(canRouteModelRequest('ollama', false, 'https://models.example.com'), false);
    assert.strictEqual(canRouteModelRequest('ollama', true, 'http://192.168.1.50:11434'), true, 'consent unblocks it');
    assert.strictEqual(canRouteModelRequest('openai', false, 'http://127.0.0.1:8080'), true, 'a local OpenAI-compatible server is still local');

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

    const previousLocalSettings = process.env.ATHENA_USE_LOCAL_SETTINGS;
    try {
      fs.writeFileSync(path.join(process.env.ATHENA_CONFIG_DIR, 'model.json'), `${JSON.stringify({
        provider: 'ollama',
        setupComplete: false,
        ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:14b', temperature: 0.7, maxTokens: 2048, numCtx: 4096 },
      }, null, 2)}\n`);
      process.env.ATHENA_USE_LOCAL_SETTINGS = '1';
      saveSettingsBundle({
        model: {
          provider: 'deepseek',
          setupComplete: true,
          remote: { deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' } },
        },
      });
      const overlayClient = new LLMClient();
      assert.strictEqual(overlayClient.providerName, 'deepseek', 'dev overlay provider must drive LLMClient');
      assert.strictEqual(overlayClient.modelName, 'deepseek-v4-flash');
      assert.strictEqual(overlayClient.endpoint, 'https://api.deepseek.com');
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(process.env.ATHENA_CONFIG_DIR, 'model.json'), 'utf8')).provider,
        'ollama',
        'tracked model.json must stay at the shipping default',
      );
      delete process.env.ATHENA_USE_LOCAL_SETTINGS;
      const trackedClient = new LLMClient();
      assert.strictEqual(trackedClient.providerName, 'ollama', 'tests without overlay must not absorb developer DeepSeek settings');
    } finally {
      if (previousLocalSettings === undefined) delete process.env.ATHENA_USE_LOCAL_SETTINGS;
      else process.env.ATHENA_USE_LOCAL_SETTINGS = previousLocalSettings;
    }

    const cleared = credentials.clearModelCredential('openai');
    assert.strictEqual(cleared.configured, true);
    assert.strictEqual(cleared.source, 'local-env-file');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-stale-local-file');
    fs.rmSync(path.join(scratch, '.env'));
    assert.strictEqual(credentials.getModelCredentialStatus('openai').configured, false);
    assert.strictEqual(credentials.resolveModelCredential('openai'), null);

    // A declared but empty KEY= must read as "not configured". It previously matched
    // across the line break and adopted the following line as the credential, so the
    // provider answered "invalid api key" instead of Athena saying it had none.
    const envFile = path.join(scratch, '.env');
    const writeEnv = contents => fs.writeFileSync(envFile, contents, 'utf8');
    for (const [label, contents] of [
      ['LF', 'OPENAI_API_KEY=\nOPENAI_MODEL=gpt-fixture\n'],
      ['CRLF', 'OPENAI_API_KEY=\r\nOPENAI_MODEL=gpt-fixture\r\n'],
      ['trailing spaces', 'OPENAI_API_KEY=   \nOPENAI_MODEL=gpt-fixture\n'],
      ['blank line between', 'OPENAI_API_KEY=\n\nOPENAI_MODEL=gpt-fixture\n'],
    ]) {
      writeEnv(contents);
      assert.strictEqual(
        credentials.resolveModelCredential('openai'),
        null,
        `an empty KEY= (${label}) must not adopt the next line as the credential`,
      );
      assert.strictEqual(
        credentials.getModelCredentialStatus('openai').configured,
        false,
        `an empty KEY= (${label}) must report as unconfigured`,
      );
    }

    // The narrower pattern must still accept every shape a real env file uses.
    writeEnv('OPENAI_API_KEY=sk-plain-value\n');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-plain-value');
    writeEnv('export OPENAI_API_KEY = "sk-quoted-value"\n');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-quoted-value', 'export, spaces around = and quotes must still parse');
    writeEnv('OPENAI_API_KEY=sk-commented # 备用密钥\n');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-commented', 'a trailing comment must still be stripped');
    writeEnv('SOME_OTHER_KEY=\nOPENAI_API_KEY=sk-later-line\n');
    assert.strictEqual(credentials.resolveModelCredential('openai'), 'sk-later-line', 'a key after an unrelated empty assignment must still be found');
    writeEnv('# OPENAI_API_KEY=sk-commented-out\n');
    assert.strictEqual(credentials.resolveModelCredential('openai'), null, 'a commented-out assignment must not be read');
    fs.rmSync(envFile);
    assert.strictEqual(credentials.resolveModelCredential('openai'), null);
    console.log('ATHENA_MODEL_PROVIDERS_OK providers=ollama+openai+deepseek+athena-cloud+custom credentials=encrypted');
  } finally {
    process.chdir(originalCwd);
    delete process.env.OPENAI_API_KEY;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// app.quit() used to run in the finally, before the catch could set an exit code,
// so a failing assertion still reported success and this was not a gate at all.
main()
  .then(() => app.exit(0))
  .catch(error => {
    console.error(error?.stack || error);
    app.exit(1);
  });
