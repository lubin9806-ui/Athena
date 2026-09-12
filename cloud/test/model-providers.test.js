'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderError,
  ZhipuModelProvider,
  buildMessages,
  createModelProvider,
  readCompletion,
} = require('../src/model-providers');

test('zhipu provider builds the selected mode and bounded request without leaking the key', async () => {
  const calls = [];
  const provider = new ZhipuModelProvider({
    apiKey: 'test-secret-key',
    model: 'glm-test',
    baseUrl: 'https://provider.example.test/v4/',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '  测试回答  ' }, finish_reason: 'stop' }] }),
      };
    },
  });

  const result = await provider.infer({
    prompt: '继续',
    mode: 'reason',
    history: [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }],
  });
  assert.deepEqual(result, { text: '测试回答' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://provider.example.test/v4/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret-key');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'glm-test');
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 3000);
  assert.deepEqual(body.messages.map((message) => message.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(JSON.stringify(body).includes('test-secret-key'), false);
});

test('provider selection is fail-closed and requires an explicit zhipu credential', () => {
  assert.equal(createModelProvider({ modelProvider: 'local-fixture' }).id, 'local-fixture');
  assert.throws(() => createModelProvider({ modelProvider: 'unknown' }), /Unknown model provider/);
  assert.throws(() => new ZhipuModelProvider(), /ZHIPU_API_KEY is not set/);
  assert.equal(createModelProvider({ modelProvider: 'zhipu' }, {
    apiKey: 'fixture-key',
    fetchImpl: async () => { throw new Error('not called'); },
  }).id, 'zhipu');
});

test('zhipu provider converts network, HTTP and malformed-response failures to redacted provider errors', async () => {
  const network = new ZhipuModelProvider({
    apiKey: 'secret-network-key',
    fetchImpl: async () => { throw new Error('socket included secret-network-key'); },
  });
  await assert.rejects(() => network.infer({ prompt: 'hello', mode: 'companion' }), (error) => {
    assert(error instanceof ProviderError);
    assert.equal(error.message, 'model request failed');
    assert.equal(error.message.includes('secret-network-key'), false);
    return true;
  });

  const refused = new ZhipuModelProvider({
    apiKey: 'secret-http-key',
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(() => refused.infer({ prompt: 'hello', mode: 'companion' }), (error) => {
    assert(error instanceof ProviderError);
    assert.equal(error.message, 'model request was refused');
    assert.equal(error.detail, 'status=401');
    return true;
  });

  const malformed = new ZhipuModelProvider({
    apiKey: 'secret-json-key',
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
  });
  await assert.rejects(() => malformed.infer({ prompt: 'hello', mode: 'companion' }), /model response was not JSON/);
});

test('completion parsing refuses empty or exhausted output', () => {
  assert.equal(readCompletion({ choices: [{ message: { content: ' ok ' }, finish_reason: 'stop' }] }, 3000), 'ok');
  assert.throws(() => readCompletion({ choices: [] }, 3000), /no choices/);
  assert.throws(() => readCompletion({
    choices: [{ message: { content: '' }, finish_reason: 'length' }],
    usage: { completion_tokens: 3000 },
  }, 3000), /whole output budget/);
  assert.deepEqual(buildMessages('hello', 'invalid-mode', [{ role: 'tool', content: 'ignored' }]).map((item) => item.role), ['system', 'user']);
});
