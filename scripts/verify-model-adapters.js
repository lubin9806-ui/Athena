const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requests = [];

const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
  strict: true,
};

const timezoneTool = {
  name: 'get_timezone',
  description: 'Get the timezone for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const body = bodyText ? JSON.parse(bodyText) : {};
  requests.push({ url: request.url, headers: request.headers, body });

  if (request.url === '/v1/models') {
    sendJson(response, { data: [{ id: 'fixture-openai-model' }] });
    return;
  }
  if (request.url === '/api/tags') {
    sendJson(response, { models: [{ name: 'fixture-ollama-model' }] });
    return;
  }
  if (request.url.endsWith('/chat/completions')) {
    if (body.stream) {
      const wantsUnknownStreamTool = body.messages?.some(message => String(message.content).includes('unknown stream tool'));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"id":"resp-stream","model":"fixture-openai-model","choices":[{"delta":{"content":"Checking "}}]}\n\n');
      response.write(`data: {"id":"resp-stream","model":"fixture-openai-model","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-weather","function":{"name":"${wantsUnknownStreamTool ? 'delete_' : 'get_'}","arguments":"{\\"city\\":"}}]}}]}\n\n`);
      response.write(`data: {"id":"resp-stream","model":"fixture-openai-model","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"${wantsUnknownStreamTool ? 'everything' : 'weather'}","arguments":"\\"Shanghai\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    const lastMessage = body.messages?.[body.messages.length - 1];
    if (lastMessage?.role === 'tool') {
      sendJson(response, {
        id: 'resp-final',
        model: 'fixture-openai-model',
        choices: [{ message: { role: 'assistant', content: 'Shanghai is 22 C.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
      });
      return;
    }
    const wantsBadArguments = body.messages?.some(message => String(message.content).includes('bad arguments'));
    const wantsUnknownTool = body.messages?.some(message => String(message.content).includes('unknown tool'));
    const wantsDuplicateIds = body.messages?.some(message => String(message.content).includes('duplicate ids'));
    const toolCalls = wantsDuplicateIds
      ? [
          { id: 'duplicate-call', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' } },
          { id: 'duplicate-call', type: 'function', function: { name: 'get_timezone', arguments: '{"city":"Shanghai"}' } },
        ]
      : [{
          id: 'call-weather',
          type: 'function',
          function: { name: wantsUnknownTool ? 'delete_everything' : 'get_weather', arguments: wantsBadArguments ? '{' : '{"city":"Shanghai"}' },
        }];
    sendJson(response, {
      id: 'resp-tool',
      model: 'fixture-openai-model',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls,
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    });
    return;
  }
  if (request.url === '/api/chat') {
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.write('{"model":"fixture-ollama-model","message":{"role":"assistant","content":"Checking "},"done":false}\n');
      response.write('{"model":"fixture-ollama-model","message":{"role":"assistant","content":"","tool_calls":[{"function":{"index":0,"name":"get_","arguments":"{\\"city\\":"}}]},"done":false}\n');
      response.write('{"model":"fixture-ollama-model","message":{"role":"assistant","content":"","tool_calls":[{"function":{"index":0,"name":"weather","arguments":"\\"Shanghai\\"}"}},{"function":{"index":1,"name":"get_timezone","arguments":{"city":"Shanghai"}}}]},"done":false}\n');
      response.end('{"model":"fixture-ollama-model","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":9,"eval_count":4}\n');
      return;
    }
    const lastMessage = body.messages?.[body.messages.length - 1];
    if (lastMessage?.role === 'tool') {
      sendJson(response, {
        model: 'fixture-ollama-model',
        message: { role: 'assistant', content: 'Ollama says Shanghai is 22 C.' },
        done: true,
        done_reason: 'stop',
      });
      return;
    }
    sendJson(response, {
      model: 'fixture-ollama-model',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Shanghai' } } }],
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 8,
      eval_count: 3,
    });
    return;
  }
  response.writeHead(404);
  response.end('not found');
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const host = `http://127.0.0.1:${address.port}`;
  const { LLMClient } = require(path.join(root, 'dist', 'core', 'ai', 'Client.js'));
  const { ModelCapabilityError, ModelProtocolError } = require(path.join(root, 'dist', 'core', 'ai', 'model', 'index.js'));

  try {
    const openai = new LLMClient({
      provider: 'openai',
      remote: { openai: { baseUrl: `${host}/v1`, model: 'fixture-openai-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    }, () => 'sk-fixture');
    assert.equal(openai.capabilities.nativeToolCalls, true);
    assert.equal(openai.capabilities.strictToolSchemas, true);
    assert.equal(openai.capabilities.toolResultUsesCallId, true);

    const toolResponse = await openai.chatWithTools([{ role: 'user', content: 'Weather in Shanghai?' }], [weatherTool], {
      toolChoice: 'required',
    });
    assert.equal(toolResponse.finishReason, 'tool_calls');
    assert.equal(toolResponse.toolCalls.length, 1);
    assert.deepEqual(toolResponse.toolCalls[0].arguments, { city: 'Shanghai' });
    assert.equal(toolResponse.usage.totalTokens, 16);
    const openaiToolRequest = requests.find(item => item.url === '/v1/chat/completions' && item.body.tools && !item.body.stream);
    assert.equal(openaiToolRequest.headers.authorization, 'Bearer sk-fixture');
    assert.equal(openaiToolRequest.body.tool_choice, 'required');
    assert.equal(openaiToolRequest.body.tools[0].function.strict, true);
    assert.equal(openaiToolRequest.body.max_completion_tokens, 512);

    const finalResponse = await openai.generate({
      messages: [
        { role: 'user', content: 'Weather in Shanghai?' },
        { role: 'assistant', content: '', toolCalls: toolResponse.toolCalls },
        { role: 'tool', content: '{"temperatureC":22}', toolCallId: toolResponse.toolCalls[0].id, toolName: 'get_weather' },
      ],
      mode: 'reason',
    });
    assert.equal(finalResponse.content, 'Shanghai is 22 C.');
    const followUpRequest = requests.filter(item => item.url === '/v1/chat/completions').at(-1).body;
    assert.equal(followUpRequest.messages[1].tool_calls[0].id, 'call-weather');
    assert.equal(followUpRequest.messages[2].tool_call_id, 'call-weather');

    const streamEvents = [];
    const streamed = await openai.chatWithTools([{ role: 'user', content: 'Stream weather' }], [weatherTool], {
      stream: true,
      onEvent: event => streamEvents.push(event),
    });
    assert.equal(streamed.content, 'Checking ');
    assert.equal(streamed.responseId, 'resp-stream');
    assert.deepEqual(streamed.toolCalls[0].arguments, { city: 'Shanghai' });
    assert.equal(streamEvents.filter(event => event.type === 'tool_call_delta').length, 2);
    assert.equal(streamEvents.at(-1).type, 'completed');

    await assert.rejects(
      openai.chatWithTools([{ role: 'user', content: 'bad arguments' }], [weatherTool]),
      ModelProtocolError,
      'malformed tool arguments must not reach an executor',
    );
    await assert.rejects(
      openai.chatWithTools([{ role: 'user', content: 'unknown tool' }], [weatherTool]),
      ModelProtocolError,
      'models must not call tools that were not exposed',
    );
    await assert.rejects(
      openai.chatWithTools([{ role: 'user', content: 'duplicate ids' }], [weatherTool, timezoneTool]),
      ModelProtocolError,
      'duplicate tool call ids must not reach an executor',
    );
    const rejectedStreamEvents = [];
    await assert.rejects(
      openai.chatWithTools([{ role: 'user', content: 'unknown stream tool' }], [weatherTool], {
        stream: true,
        onEvent: event => rejectedStreamEvents.push(event),
      }),
      ModelProtocolError,
      'streaming models must not call tools that were not exposed',
    );
    assert.equal(
      rejectedStreamEvents.some(event => event.type === 'completed'),
      false,
      'rejected streams must never emit a completed event',
    );

    const deepseek = new LLMClient({
      provider: 'deepseek',
      remote: { deepseek: { baseUrl: `${host}/v1`, model: 'fixture-deepseek-model', temperature: 0.2, maxTokens: 400, numCtx: 8192 } },
    }, () => 'sk-deepseek');
    assert.equal(deepseek.capabilities.strictToolSchemas, false, 'stable DeepSeek endpoints must not claim beta strict mode');
    await deepseek.chatWithTools([{ role: 'user', content: 'Weather?' }], [weatherTool], { toolChoice: { name: 'get_weather' } });
    const deepseekRequest = requests.filter(item => item.url === '/v1/chat/completions').at(-1).body;
    assert.equal(deepseekRequest.max_tokens, 400);
    assert.equal(deepseekRequest.max_completion_tokens, undefined);
    assert.equal(deepseekRequest.tools[0].function.strict, undefined);
    assert.deepEqual(deepseekRequest.tool_choice, { type: 'function', function: { name: 'get_weather' } });
    const deepseekBeta = new LLMClient({
      provider: 'deepseek',
      remote: { deepseek: { baseUrl: `${host}/beta`, model: 'fixture-deepseek-model', temperature: 0.2, maxTokens: 400, numCtx: 8192 } },
    }, () => 'sk-deepseek');
    assert.equal(deepseekBeta.capabilities.strictToolSchemas, true, 'DeepSeek beta endpoints should advertise strict tool schemas');
    await deepseekBeta.chatWithTools([{ role: 'user', content: 'Strict weather?' }], [weatherTool]);
    const deepseekBetaRequest = requests.find(item => item.url === '/beta/chat/completions');
    assert.equal(deepseekBetaRequest.body.tools[0].function.strict, true);
    await assert.rejects(
      deepseek.chatWithTools([{ role: 'user', content: 'Wrong tool' }], [weatherTool], { toolChoice: { name: 'missing_tool' } }),
      ModelCapabilityError,
    );

    const custom = new LLMClient({
      provider: 'custom',
      remote: { custom: { baseUrl: `${host}/v1`, model: 'fixture-custom-model', temperature: 0.2, maxTokens: 400, numCtx: 8192 } },
    }, () => null);
    await assert.rejects(
      custom.chatWithTools([{ role: 'user', content: 'Must call' }], [weatherTool], { toolChoice: 'required' }),
      ModelCapabilityError,
      'custom providers should use conservative capabilities until configured',
    );

    const ollama = new LLMClient({
      provider: 'ollama',
      ollama: { baseUrl: host, model: 'fixture-ollama-model', temperature: 0.2, maxTokens: 256, numCtx: 4096 },
    });
    assert.equal(ollama.capabilities.toolResultUsesName, true);
    assert.equal(await ollama.checkConnection(), true);
    const ollamaTool = await ollama.chatWithTools([{ role: 'user', content: 'Weather?' }], [weatherTool]);
    assert.deepEqual(ollamaTool.toolCalls[0].arguments, { city: 'Shanghai' });
    const ollamaFinal = await ollama.generate({
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: '', toolCalls: ollamaTool.toolCalls },
        { role: 'tool', content: '{"temperatureC":22}', toolCallId: ollamaTool.toolCalls[0].id, toolName: 'get_weather' },
      ],
    });
    assert.equal(ollamaFinal.content, 'Ollama says Shanghai is 22 C.');
    const ollamaFollowUp = requests.filter(item => item.url === '/api/chat').at(-1).body;
    assert.equal(ollamaFollowUp.messages[2].tool_name, 'get_weather');
    assert.equal(ollamaFollowUp.messages[1].tool_calls[0].function.index, 0);
    assert.deepEqual(ollamaFollowUp.messages[1].tool_calls[0].function.arguments, { city: 'Shanghai' });

    const ollamaEvents = [];
    const ollamaStream = await ollama.chatWithTools([{ role: 'user', content: 'Stream weather' }], [weatherTool, timezoneTool], {
      stream: true,
      onEvent: event => ollamaEvents.push(event),
    });
    assert.equal(ollamaStream.content, 'Checking ');
    assert.deepEqual(ollamaStream.toolCalls[0].arguments, { city: 'Shanghai' });
    assert.equal(ollamaStream.toolCalls[0].name, 'get_weather');
    assert.equal(ollamaStream.toolCalls[1].name, 'get_timezone');
    assert.equal(ollamaStream.usage.totalTokens, 13);
    assert.equal(ollamaEvents.at(-1).type, 'completed');
    await assert.rejects(
      ollama.chatWithTools([{ role: 'user', content: 'Must call' }], [weatherTool], { toolChoice: 'required' }),
      ModelCapabilityError,
    );

    console.log(`ATHENA_MODEL_ADAPTERS_OK openaiCalls=${requests.filter(item => item.url === '/v1/chat/completions').length} ollamaCalls=${requests.filter(item => item.url === '/api/chat').length}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function sendJson(response, value) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

main().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
