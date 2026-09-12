'use strict';

/**
 * Real model providers for the Cloud gateway.
 *
 * Until now `config.modelProvider` could name anything and the server still
 * constructed a LocalFixtureModelProvider, so the setting looked configurable
 * and was not: the policy lookup would find one provider's terms while a
 * different provider answered every request. `createModelProvider` is the only
 * way a provider is chosen now, and it refuses a name it does not implement
 * rather than quietly falling back.
 */

// Long enough for a reasoning model to think, short enough that a request does
// not hang a phone. The client already retries on 503.
const DEFAULT_TIMEOUT_MS = 60_000;
// A reasoning model spends output budget before it writes any content at all.
// Too small a ceiling means the whole budget goes to thinking and the answer
// comes back empty with finish_reason=length, which reads as success.
const DEFAULT_MAX_OUTPUT_TOKENS = 3_000;
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

const SYSTEM_PROMPTS = {
  companion: '你是 Athena，一个陪伴型的助手。用自然、简短的中文说话，不要客套开场白。',
  create: '你是 Athena，帮用户把想法写成具体的东西。给出可用的成稿，而不是关于怎么写的建议。',
  reason: '你是 Athena。把问题拆开想清楚再回答，结论要能被追问。用中文。',
};

const TEMPERATURES = { companion: 0.8, create: 0.9, reason: 0.3 };

class ProviderError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ProviderError';
    // Kept off the message so a key or a prompt cannot reach a log through it.
    this.detail = detail;
  }
}

/**
 * Zhipu BigModel, the same vendor the desktop already uses for web search, over
 * its OpenAI-shaped chat completions endpoint.
 */
class ZhipuModelProvider {
  constructor(options = {}) {
    this.id = 'zhipu';
    this.apiKey = options.apiKey;
    if (!this.apiKey) {
      // Failing here rather than on the first request: a server that starts
      // without a key would answer every conversation with a 503 and look like
      // an outage at the vendor.
      throw new Error('ZHIPU_API_KEY is not set, so the zhipu model provider cannot be used.');
    }
    this.model = options.model || 'glm-4-flash';
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('No fetch implementation is available.');
  }

  async infer({ prompt, mode, history = [] }) {
    const response = await this.post({
      model: this.model,
      messages: buildMessages(prompt, mode, history),
      max_tokens: this.maxOutputTokens,
      temperature: TEMPERATURES[mode] ?? 0.7,
      stream: false,
    });
    return { text: readCompletion(response, this.maxOutputTokens) };
  }

  async post(body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError('model request failed', error instanceof Error ? error.name : 'unknown');
    }
    if (!response.ok) {
      // The vendor's body can quote the prompt back, so only the status travels.
      throw new ProviderError('model request was refused', `status=${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError('model response was not JSON');
    }
  }
}

function buildMessages(prompt, mode, history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.companion }];
  for (const turn of history) {
    if (turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

/**
 * The answer, or a refusal to call an empty one an answer.
 *
 * A reasoning model that runs out of output budget before writing anything
 * returns finish_reason=length with zero characters of content. Returned as-is
 * that is an empty assistant turn the user has no explanation for, and nothing
 * in the system looks broken. It is treated as a provider failure, which the
 * gateway already turns into a 503 the client knows how to retry.
 */
function readCompletion(payload, maxOutputTokens) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (!choice) throw new ProviderError('model response had no choices');
  const text = typeof choice.message?.content === 'string' ? choice.message.content.trim() : '';
  if (text) return text;
  const spent = payload.usage?.completion_tokens;
  if (choice.finish_reason === 'length') {
    throw new ProviderError(
      'model spent its whole output budget before writing anything',
      `finish=length tokens=${spent ?? '?'}/${maxOutputTokens}`,
    );
  }
  throw new ProviderError('model returned no content', `finish=${choice.finish_reason || 'unknown'}`);
}

/**
 * The one place a provider is chosen. An unknown name is an error rather than a
 * silent fallback: a deployment that meant to use a real model and got the echo
 * fixture instead would look like it was working.
 */
function createModelProvider(config, options = {}) {
  const { LocalFixtureModelProvider } = require('./services');
  switch (config.modelProvider) {
    case 'local-fixture':
      return new LocalFixtureModelProvider();
    case 'zhipu':
      return new ZhipuModelProvider({
        apiKey: options.apiKey || process.env.ZHIPU_API_KEY,
        model: options.model || process.env.ATHENA_CLOUD_MODEL_NAME,
        baseUrl: options.baseUrl || process.env.ATHENA_CLOUD_MODEL_BASE_URL,
        fetchImpl: options.fetchImpl,
      });
    default:
      throw new Error(`Unknown model provider: ${config.modelProvider}`);
  }
}

module.exports = { ZhipuModelProvider, ProviderError, createModelProvider, readCompletion, buildMessages };
