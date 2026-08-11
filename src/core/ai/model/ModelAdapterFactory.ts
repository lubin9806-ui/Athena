import type {
  ModelProvider,
  RemoteModelProvider,
  RemoteModelSettings,
} from '../../../shared/types';
import type { ModelAdapter } from './ModelAdapter';
import { OllamaAdapter } from './OllamaAdapter';
import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter';

export interface ModelClientConfig {
  provider?: ModelProvider;
  ollama?: Partial<RemoteModelSettings>;
  remote?: Partial<Record<RemoteModelProvider, Partial<RemoteModelSettings>>>;
  fallback?: { timeoutMs?: number };
}

export type ModelCredentialResolver = (provider: RemoteModelProvider) => string | null;

export interface ResolvedModelRuntime {
  provider: ModelProvider;
  settings: RemoteModelSettings;
  requestTimeoutMs: number;
  adapter: ModelAdapter;
}

const REMOTE_DEFAULTS: Record<RemoteModelProvider, RemoteModelSettings> = {
  openai: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  deepseek: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  'athena-cloud': { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  custom: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
};

const OLLAMA_DEFAULTS: RemoteModelSettings = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:14b',
  temperature: 0.7,
  maxTokens: 2048,
  numCtx: 4096,
};

export function createModelRuntime(
  config: ModelClientConfig,
  credentialResolver: ModelCredentialResolver,
): ResolvedModelRuntime {
  const provider = config.provider ?? 'ollama';
  const selected = provider === 'ollama'
    ? { ...OLLAMA_DEFAULTS, ...config.ollama }
    : { ...REMOTE_DEFAULTS[provider], ...config.remote?.[provider] };
  const settings: RemoteModelSettings = {
    baseUrl: String(selected.baseUrl || '').replace(/\/$/, ''),
    model: String(selected.model || ''),
    temperature: finiteNumber(selected.temperature, 0.7),
    maxTokens: finiteNumber(selected.maxTokens, 2048),
    numCtx: finiteNumber(selected.numCtx, provider === 'ollama' ? 4096 : 32768),
  };
  const requestTimeoutMs = clampInteger(config.fallback?.timeoutMs ?? 30_000, 250, 120_000);
  const adapter = provider === 'ollama'
    ? new OllamaAdapter({ baseUrl: settings.baseUrl, model: settings.model, requestTimeoutMs })
    : new OpenAICompatibleAdapter({
        provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: credentialResolver(provider),
        requestTimeoutMs,
      });
  return { provider, settings, requestTimeoutMs, adapter };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInteger(value: unknown, min: number, max: number): number {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : min));
}
