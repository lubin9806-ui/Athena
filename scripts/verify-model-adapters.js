const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requests = [];
/** Responses deliberately left hanging, so the server can still shut down. */
const stalledResponses = [];
const SLOW_STREAM_CHUNKS = 8;
const SLOW_STREAM_GAP_MS = 120;

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

  // A model that is answering at length: every gap is short, but the whole answer
  // outlives any single wall-clock budget.
  if (request.url.startsWith('/slow-stream/')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      response.write(`data: {"id":"resp-slow","model":"fixture-openai-model","choices":[{"delta":{"content":"tok${sent} "}}]}\n\n`);
      if (sent >= SLOW_STREAM_CHUNKS) {
        clearInterval(timer);
        response.end('data: [DONE]\n\n');
      }
    }, SLOW_STREAM_GAP_MS);
    response.on('close', () => clearInterval(timer));
    return;
  }
  // Transport failures the way providers and proxies actually produce them.
  if (request.url.startsWith('/drop/')) {
    request.socket.destroy();
    return;
  }
  if (request.url.startsWith('/truncate/')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"id":"resp-truncated","choices":[{"message":{"role":"assistant","content":"par');
    setTimeout(() => request.socket.destroy(), 30);
    return;
  }
  if (request.url.startsWith('/overloaded/')) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Server overloaded, please retry later' } }));
    return;
  }
  // A reasoning model that spent its output budget thinking: the tool call stops mid-argument.
  if (request.url.startsWith('/truncated-tool/') || request.url.startsWith('/malformed-tool/')) {
    const truncated = request.url.startsWith('/truncated-tool/');
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"id":"resp-cut","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-cut","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Shang"}}]}}]}\n\n');
      response.write(`data: {"id":"resp-cut","choices":[{"delta":{},"finish_reason":"${truncated ? 'length' : 'tool_calls'}"}]}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    sendJson(response, {
      id: 'resp-cut',
      model: 'fixture-openai-model',
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-cut', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Shang' } }] },
        finish_reason: truncated ? 'length' : 'tool_calls',
      }],
    });
    return;
  }
  if (request.url.startsWith('/missing-model/')) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Model Not Exist', type: 'invalid_request_error' } }));
    return;
  }
  // A model that starts talking and then genuinely goes dead.
  if (request.url.startsWith('/stalled/')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"id":"resp-stalled","model":"fixture-openai-model","choices":[{"delta":{"content":"start "}}]}\n\n');
    stalledResponses.push(response);
    return;
  }

  if (request.url === '/v1/models') {
    sendJson(response, { data: [{ id: 'fixture-openai-model' }] });
    return;
  }
  if (request.url === '/api/tags') {
    sendJson(response, { models: [{ name: 'fixture-ollama-model' }] });
    return;
  }
  if (request.url === '/api/show') {
    sendJson(response, { capabilities: ['completion', 'vision'] });
    return;
  }
  if (request.url.endsWith('/chat/completions')) {
    if (body.messages?.some(message => Array.isArray(message.content))) {
      sendJson(response, {
        id: 'resp-vision',
        model: body.model,
        choices: [{ message: { role: 'assistant', content: 'I can see the image.' }, finish_reason: 'stop' }],
      });
      return;
    }
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
    if (body.messages?.some(message => Array.isArray(message.images) && message.images.length > 0)) {
      sendJson(response, {
        model: body.model,
        message: { role: 'assistant', content: 'Ollama can see the image.' },
        done: true,
        done_reason: 'stop',
      });
      return;
    }
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
    assert.equal(openai.capabilities.imageInputs, false, 'unknown OpenAI model ids must not claim vision');

    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const imagePath = path.join(os.tmpdir(), `athena-model-image-${process.pid}.png`);
    fs.writeFileSync(imagePath, imageBytes);
    const image = {
      id: 'fixture-image',
      mimeType: 'image/png',
      filePath: imagePath,
      sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'),
      bytes: imageBytes.length,
    };
    const visionOpenAI = new LLMClient({
      provider: 'openai',
      remote: { openai: { baseUrl: `${host}/v1`, model: 'gpt-5.6-fixture', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    }, () => 'sk-fixture');
    assert.equal(visionOpenAI.capabilities.imageInputs, true);
    const visionResponse = await visionOpenAI.generate({ messages: [{ role: 'user', content: 'Describe it', images: [image] }] });
    assert.equal(visionResponse.content, 'I can see the image.');
    const openAIVisionRequest = requests.filter(item => item.url === '/v1/chat/completions').at(-1).body;
    assert.equal(openAIVisionRequest.messages[0].content[1].type, 'image_url');
    assert.ok(openAIVisionRequest.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));

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
    assert.equal(deepseek.capabilities.imageInputs, false, 'OpenAI-compatible providers must not inherit OpenAI vision claims');
    await assert.rejects(
      deepseek.generate({ messages: [{ role: 'user', content: 'Describe it', images: [image] }] }),
      ModelCapabilityError,
    );
    const deepseekVision = new LLMClient({
      provider: 'deepseek',
      remote: { deepseek: { baseUrl: `${host}/v1`, model: 'deepseek-v4-flash-vision-exp', temperature: 0.2, maxTokens: 400, numCtx: 8192 } },
    }, () => 'sk-deepseek');
    assert.equal(deepseekVision.capabilities.imageInputs, true, 'the official DeepSeek vision model must accept image inputs');
    assert.equal(deepseekVision.capabilities.imageInputSource, 'static');
    const deepseekVisionResponse = await deepseekVision.generate({
      messages: [{ role: 'user', content: 'Describe this image', images: [image] }],
    });
    assert.equal(deepseekVisionResponse.content, 'I can see the image.');
    const deepseekVisionRequest = requests.find(item => (
      item.url === '/v1/chat/completions' && item.body.model === 'deepseek-v4-flash-vision-exp'
    ));
    assert.ok(deepseekVisionRequest, 'DeepSeek vision request must reach Chat Completions');
    assert.equal(deepseekVisionRequest.body.messages[0].content[0].type, 'text');
    assert.equal(deepseekVisionRequest.body.messages[0].content[1].type, 'image_url');
    assert.ok(deepseekVisionRequest.body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));
    assert.equal(deepseekVisionRequest.body.messages[0].content[1].image_url.detail, 'auto');
    assert.equal(deepseekVisionRequest.body.max_tokens, 400);
    const unverifiedDeepseekVisionAlias = new LLMClient({
      provider: 'deepseek',
      remote: { deepseek: { baseUrl: `${host}/v1`, model: 'deepseek-v4-flash-vision', temperature: 0.2, maxTokens: 400, numCtx: 8192 } },
    }, () => 'sk-deepseek');
    assert.equal(unverifiedDeepseekVisionAlias.capabilities.imageInputs, false, 'unverified DeepSeek model aliases must remain closed');
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
    assert.equal(ollama.capabilities.imageInputs, false, 'Ollama vision must start closed until probed');
    const ollamaCapabilities = await ollama.refreshCapabilities();
    assert.equal(ollamaCapabilities.imageInputs, true);
    const ollamaVision = await ollama.generate({ messages: [{ role: 'user', content: 'Describe it', images: [image] }] });
    assert.equal(ollamaVision.content, 'Ollama can see the image.');
    const ollamaVisionRequest = requests.filter(item => item.url === '/api/chat').at(-1).body;
    assert.equal(ollamaVisionRequest.messages[0].images[0], imageBytes.toString('base64'));
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

    // ATH-CHAT-003: a broken response reads as a refusal when the parser text is
    // forwarded verbatim. Machine-facing categories get rewritten; messages that
    // were already written for a person must survive untouched.
    const { classifyModelFailure, redactModelFailureDetail } = require(path.join(root, 'dist', 'core', 'ai', 'ModelFailure.js'));

    const truncated = classifyModelFailure(new ModelProtocolError(
      'Tool write_file returned invalid JSON arguments: Unterminated string in JSON at position 412',
    ));
    assert.equal(truncated.kind, 'protocol');
    assert.equal(truncated.retryable, true);
    assert(!/Unterminated|JSON at position|write_file/.test(truncated.message), 'parser text must not reach the user');
    assert.match(truncated.message, /没有执行任何操作/);
    assert.match(truncated.detail, /Unterminated string/, 'the original stays available for the log');

    const auth = classifyModelFailure(new Error('DeepSeek request failed: 401 Authorization Required - {"error":{"message":"Authentication Fails"}}'));
    assert.equal(auth.kind, 'auth');
    assert.equal(auth.retryable, false);
    assert.match(auth.message, /API Key/);
    assert(!/401|Authorization Required/.test(auth.message));

    assert.equal(classifyModelFailure(new Error('429 Too Many Requests')).kind, 'rate_limit');
    assert.equal(classifyModelFailure(new Error('request timed out after 8000ms')).kind, 'timeout');
    assert.equal(classifyModelFailure(new Error('fetch failed: ECONNREFUSED 127.0.0.1:11434')).kind, 'connection');
    const cancelled = classifyModelFailure(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    assert.equal(cancelled.kind, 'cancelled');
    assert.equal(cancelled.retryable, false);

    // The platform's own timeout is worded "The operation was aborted due to
    // timeout". Reading that as a cancellation is what put "已停止。" in front of
    // people whose model had merely been slow, so assert the real object rather
    // than a hand-written message that happens to dodge the overlap.
    const platformTimeout = await new Promise(resolve => {
      const signal = AbortSignal.timeout(5);
      setTimeout(() => resolve(signal.reason), 60);
    });
    assert.match(platformTimeout.message, /aborted/i, 'fixture must reproduce the overlapping wording');
    const classifiedPlatformTimeout = classifyModelFailure(platformTimeout);
    assert.equal(classifiedPlatformTimeout.kind, 'timeout');
    assert.notEqual(classifiedPlatformTimeout.message, '已停止。');

    // Product guidance is already user-facing and must not become a generic sentence.
    const consent = '远程模型服务需要先在“隐私与数据中心”阅读说明并明确同意。';
    const passthrough = classifyModelFailure(new Error(consent));
    assert.equal(passthrough.kind, 'passthrough');
    assert.equal(passthrough.message, consent);
    const capability = classifyModelFailure(new ModelCapabilityError('当前模型不支持原生工具调用。'));
    assert.equal(capability.kind, 'capability');
    assert.equal(capability.message, '当前模型不支持原生工具调用。');

    // The budget used to be a single wall-clock deadline over the whole exchange,
    // so a long answer was cut off mid-stream and reported as a dead connection.
    // These drive the real adapter: the bug lived in how the signal was built, so
    // a re-implementation of it here would prove nothing.
    const idleMs = 400;
    const slowClient = new LLMClient({
      provider: 'openai',
      remote: { openai: { baseUrl: `${host}/slow-stream/v1`, model: 'fixture-openai-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
      fallback: { timeoutMs: idleMs },
    }, () => 'sk-fixture');
    const slowStarted = Date.now();
    const slowText = await slowClient.chat([{ role: 'user', content: 'Answer at length' }], () => {});
    const slowElapsed = Date.now() - slowStarted;
    const expectedText = Array.from({ length: SLOW_STREAM_CHUNKS }, (_, index) => `tok${index + 1} `).join('');
    assert.equal(slowText, expectedText, 'a stream that keeps producing must arrive complete');
    assert(
      slowElapsed > idleMs,
      `the answer must outlive the budget for this to prove anything (took ${slowElapsed}ms, budget ${idleMs}ms)`,
    );

    // Silence, on the other hand, still has to end the turn -- as a timeout.
    const stalledClient = new LLMClient({
      provider: 'openai',
      remote: { openai: { baseUrl: `${host}/stalled/v1`, model: 'fixture-openai-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
      fallback: { timeoutMs: idleMs },
    }, () => 'sk-fixture');
    const stalledStarted = Date.now();
    let stalledError;
    try {
      await stalledClient.chat([{ role: 'user', content: 'Go quiet' }], () => {});
    } catch (error) {
      stalledError = error;
    }
    assert(stalledError, 'a provider that goes silent must not hang forever');
    const stalledFailure = classifyModelFailure(stalledError);
    assert.equal(stalledFailure.kind, 'timeout', 'silence is a timeout, not a cancellation');
    assert.notEqual(stalledFailure.message, '已停止。', 'nobody pressed stop');
    assert(Date.now() - stalledStarted < 60_000, 'the idle budget must apply once the stream has started');

    // Listing models involves no thinking, so it gets no think-time allowance: the
    // settings connection test must not sit there for minutes on a wedged server.
    const metadataStarted = Date.now();
    await assert.rejects(stalledClient.listModels());
    const metadataElapsed = Date.now() - metadataStarted;
    assert(
      metadataElapsed < idleMs * 10,
      `metadata calls stay inside the configured budget (took ${metadataElapsed}ms, budget ${idleMs}ms)`,
    );

    // The stop button must still read as a cancellation.
    const abortController = new AbortController();
    const abortClient = new LLMClient({
      provider: 'openai',
      remote: { openai: { baseUrl: `${host}/slow-stream/v1`, model: 'fixture-openai-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
      fallback: { timeoutMs: 30_000 },
    }, () => 'sk-fixture');
    setTimeout(() => abortController.abort(), SLOW_STREAM_GAP_MS * 2);
    let abortError;
    try {
      await abortClient.chatWithTools([{ role: 'user', content: 'Stop me' }], [], {
        stream: true,
        signal: abortController.signal,
        onEvent: () => {},
      });
    } catch (error) {
      abortError = error;
    }
    assert(abortError, 'aborting must reject');
    assert.equal(classifyModelFailure(abortError).kind, 'cancelled', 'an explicit stop stays a cancellation');

    // Nothing key-shaped may survive into a log line.
    const secret = redactModelFailureDetail('auth failed for sk-0123456789abcdef0123 with Bearer abcdefghijklmnop');
    assert(!/sk-0123456789abcdef0123|abcdefghijklmnop/.test(secret), 'credentials must be redacted from diagnostics');
    assert.match(secret, /\[REDACTED\]/);

    const transport = await verifyTransportFailures(host, LLMClient, classifyModelFailure);

    console.log(`ATHENA_MODEL_ADAPTERS_OK openaiCalls=${requests.filter(item => item.url === '/v1/chat/completions').length} ollamaCalls=${requests.filter(item => item.url === '/api/chat').length} transport=${transport}`);
    fs.rmSync(imagePath, { force: true });
  } finally {
    for (const stalled of stalledResponses) stalled.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * `fetch` reports every transport failure as "fetch failed" - or "terminated" once
 * the body is being read - and keeps what happened on `cause`. The 2026-09-14
 * outage left only "fetch failed" in the run log. Each error below is thrown by a
 * real request, never written by hand: a hand-written message only contains the
 * words its author thought of.
 */
async function verifyTransportFailures(host, LLMClient, classifyModelFailure) {
  const net = require('node:net');
  const capture = async run => {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('expected the request to fail');
  };
  const client = prefix => new LLMClient({
    provider: 'openai',
    remote: { openai: { baseUrl: `${host}/${prefix}/v1`, model: 'fixture-openai-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    fallback: { timeoutMs: 5_000 },
  }, () => 'sk-fixture');
  const ask = prefix => capture(() => client(prefix).chatWithTools([{ role: 'user', content: 'hello' }], [weatherTool]));
  const checked = [];
  const expect = (label, error, expected) => {
    const failure = classifyModelFailure(error);
    assert.equal(failure.code, expected.code, `${label}: ${failure.code} (${failure.detail})`);
    assert.equal(failure.kind, expected.kind, label);
    assert.equal(failure.retryable, expected.retryable, label);
    assert.match(failure.detail, expected.detail, `${label}: the cause must reach the log (${failure.detail})`);
    assert.match(failure.message, expected.message, `${label}: ${failure.message}`);
    assert.doesNotMatch(failure.message, /fetch failed|terminated|UND_ERR|\{"/, `${label}: the message is written for a person`);
    checked.push(label);
  };

  const dropped = await ask('drop');
  assert.equal(dropped.message, 'fetch failed', 'fixture must reproduce the opaque top-level message');
  expect('socket-closed', dropped, { code: 'model.connection.reset', kind: 'connection', retryable: true, detail: /UND_ERR_SOCKET/, message: /连接在请求途中被断开/ });

  // The body read fails with "terminated", which no text rule used to recognise:
  // it was passed straight to the chat and, as unclassified, never retried.
  const truncated = await ask('truncate');
  assert.equal(truncated.message, 'terminated', 'fixture must reproduce the mid-body wording');
  expect('closed-mid-body', truncated, { code: 'model.connection.reset', kind: 'connection', retryable: true, detail: /terminated.*UND_ERR_SOCKET/, message: /连接在请求途中被断开/ });

  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const refused = await capture(() => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}' }));
  expect('refused', refused, { code: 'model.connection.refused', kind: 'connection', retryable: true, detail: /ECONNREFUSED/, message: new RegExp(`127\\.0\\.0\\.1:${port}.*拒绝了连接`) });

  const reset = await new Promise(resolve => {
    const resetting = net.createServer(socket => socket.on('data', () => socket.resetAndDestroy()));
    resetting.listen(0, '127.0.0.1', async () => {
      const error = await capture(() => fetch(`http://127.0.0.1:${resetting.address().port}/v1/chat/completions`, { method: 'POST', body: '{}' }));
      resetting.close(() => resolve(error));
    });
  });
  expect('tcp-reset', reset, { code: 'model.connection.reset', kind: 'connection', retryable: true, detail: /ECONNRESET/, message: /连接在请求途中被断开/ });

  const plainPort = new URL(host).port;
  const tls = await capture(() => fetch(`https://127.0.0.1:${plainPort}/v1/models`));
  expect('tls-to-plain-http', tls, { code: 'model.connection.tls', kind: 'connection', retryable: false, detail: /ERR_SSL_/, message: /加密连接失败/ });

  const dns = await capture(() => fetch('https://athena-model-probe.invalid/v1/models', { signal: AbortSignal.timeout(20_000) }));
  assert.notEqual(dns.name, 'TimeoutError', 'the resolver must answer for .invalid; this environment cannot produce a real DNS failure');
  expect('dns', dns, { code: 'model.connection.dns', kind: 'connection', retryable: true, detail: /ENOTFOUND/, message: /athena-model-probe\.invalid/ });

  expect('http-503', await ask('overloaded'), { code: 'model.server_error', kind: 'connection', retryable: true, detail: /503/, message: /HTTP 503/ });
  const missing = classifyModelFailure(await ask('missing-model'));
  assert.equal(missing.code, 'model.request_rejected');
  assert.equal(missing.retryable, false);
  assert.match(missing.message, /HTTP 404.*Model Not Exist/, 'the provider\'s own reason is the useful part of a rejection');
  checked.push('http-404');

  // Arguments cut off at the length limit are a budget problem, told apart from a
  // model that simply wrote bad JSON - in both the plain and the streaming path.
  for (const stream of [false, true]) {
    const cut = await capture(() => client('truncated-tool').chatWithTools([{ role: 'user', content: 'weather' }], [weatherTool], { stream, onEvent: () => {} }));
    assert.equal(cut.name, 'ModelOutputTruncatedError', `stream=${stream}: ${cut.name} ${cut.message}`);
    const cutFailure = classifyModelFailure(cut);
    assert.equal(cutFailure.code, 'model.output_truncated');
    assert.match(cutFailure.message, /长度上限/);
    const malformed = await capture(() => client('malformed-tool').chatWithTools([{ role: 'user', content: 'weather' }], [weatherTool], { stream, onEvent: () => {} }));
    assert.equal(malformed.name, 'ModelProtocolError', `stream=${stream}: bad JSON without a length stop is not truncation`);
    assert.equal(classifyModelFailure(malformed).code, 'model.protocol');
  }
  checked.push('output-truncated');

  // A detail line persisted earlier and read back keeps its meaning: undici's
  // "Connect Timeout Error" is a network problem, not a slow model.
  const persistedConnectTimeout = classifyModelFailure(new Error('fetch failed <- Connect Timeout Error (attempted address: api.deepseek.com:443, timeout: 10000ms) code=UND_ERR_CONNECT_TIMEOUT'));
  assert.equal(persistedConnectTimeout.code, 'model.connection.timeout');
  assert.doesNotMatch(persistedConnectTimeout.message, /更快的模型/);
  checked.push('persisted-connect-timeout');
  return checked.join(',');
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
