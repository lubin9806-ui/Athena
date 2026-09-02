import type { ImageCloudProvider, ImageRemoteProviderSettings } from '../../shared/types';
import {
  inspectImage,
  type GeneratedImage,
  type ImageEditRequest,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
  type ImageOutputFormat,
} from './OpenAIImageGenerationProvider';

interface RemoteProviderOptions {
  provider: ImageCloudProvider;
  settingsResolver: () => ImageRemoteProviderSettings;
  credentialResolver: () => string | null;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
  fetcher?: typeof fetch;
}

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

abstract class RemoteImageProviderBase implements ImageGenerationProvider {
  protected readonly fetcher: typeof fetch;

  constructor(protected readonly options: RemoteProviderOptions) {
    this.fetcher = options.fetcher || fetch;
  }

  abstract generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage>;

  protected settings(): ImageRemoteProviderSettings {
    const settings = this.options.settingsResolver();
    if (!settings.model.trim()) throw new Error(`${this.options.provider} 生图模型尚未配置。`);
    if (!settings.baseUrl.trim()) throw new Error(`${this.options.provider} 生图 API 地址尚未配置。`);
    return { model: settings.model.trim(), baseUrl: settings.baseUrl.trim().replace(/\/$/, '') };
  }

  protected credential(): string {
    const credential = this.options.credentialResolver()?.trim();
    if (!credential) throw new Error(`${this.options.provider} 生图 API Key 尚未配置。`);
    return credential;
  }

  protected async imageFromUrl(url: string, model: string, requestId: string | null, signal: AbortSignal, usage?: Record<string, unknown>): Promise<GeneratedImage> {
    const response = await fetchSafeUrl(this.fetcher, url, signal);
    if (!response.ok) throw new Error(`${this.options.provider} 图片下载失败（${response.status}）。`);
    const bytes = await readBoundedBytes(response, MAX_IMAGE_BYTES, signal);
    return this.validated(bytes, model, requestId, usage);
  }

  protected validated(bytes: Buffer, model: string, requestId: string | null, usage?: Record<string, unknown>): GeneratedImage {
    const inspected = inspectImage(bytes);
    const decoded = this.options.decodeValidator(bytes);
    if (inspected.width !== decoded.width || inspected.height !== decoded.height) throw new Error(`${this.options.provider} 图片解码尺寸不一致。`);
    return {
      bytes,
      format: inspected.format,
      width: inspected.width,
      height: inspected.height,
      provider: this.options.provider,
      model,
      requestId,
      ...(usage ? { usage } : {}),
    };
  }
}

export class GoogleImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    return this.interact(request, undefined, signal);
  }

  async edit(request: ImageEditRequest, signal: AbortSignal): Promise<GeneratedImage> {
    if (request.mask) throw new Error('Google 当前通道不支持 Athena 的独立蒙版参数，请在提示词中描述编辑区域。');
    return this.interact(request, request, signal);
  }

  private async interact(request: ImageGenerationRequest, edit: ImageEditRequest | undefined, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const input: unknown[] = [{ type: 'text', text: requirePrompt(request.prompt) }];
    for (const image of edit?.images || []) input.push({ type: 'image', mime_type: image.mimeType, data: image.bytes.toString('base64') });
    const response = await this.fetcher(settings.baseUrl, {
      method: 'POST', redirect: 'manual', signal,
      headers: { 'x-goog-api-key': this.credential(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        input,
        response_format: { type: 'image', aspect_ratio: aspectRatio(request.size), image_size: imageScale(request.size) },
      }),
    });
    rejectRedirect(response, 'Google');
    const payload = await readJson(response, signal);
    if (!response.ok) throw apiFailure('Google', response, payload);
    const encoded = findBase64Image(payload);
    if (!encoded) throw new Error('Google 生图响应中没有可用图片。');
    return this.validated(Buffer.from(encoded, 'base64'), settings.model, response.headers.get('x-request-id'));
  }
}

export class StabilityImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const form = new FormData();
    form.set('prompt', requirePrompt(request.prompt));
    form.set('aspect_ratio', aspectRatio(request.size));
    form.set('output_format', stabilityFormat(request.outputFormat));
    const response = await this.fetcher(settings.baseUrl, {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Bearer ${this.credential()}`, Accept: 'image/*' },
      body: form,
    });
    rejectRedirect(response, 'Stability');
    if (!response.ok) {
      const payload = await readJson(response, signal);
      throw apiFailure('Stability', response, payload);
    }
    return this.validated(await readBoundedBytes(response, MAX_IMAGE_BYTES, signal), settings.model, response.headers.get('x-request-id'));
  }
}

export class BflImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const { width, height } = dimensions(request.size);
    const response = await this.fetcher(`${settings.baseUrl}/${encodeURIComponent(settings.model)}`, {
      method: 'POST', redirect: 'manual', signal,
      headers: { 'x-key': this.credential(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt: requirePrompt(request.prompt), width, height, output_format: request.outputFormat === 'jpeg' ? 'jpeg' : 'png' }),
    });
    rejectRedirect(response, 'BFL');
    const created = await readJson(response, signal);
    if (!response.ok) throw apiFailure('BFL', response, created);
    const pollingUrl = stringAt(created, 'polling_url');
    const requestId = stringAt(created, 'id') || null;
    if (!pollingUrl) throw new Error('BFL 未返回任务轮询地址。');
    const result = await pollJson(this.fetcher, pollingUrl, {
      signal,
      headers: { 'x-key': this.credential(), Accept: 'application/json' },
      done: value => stringAt(value, 'status') === 'Ready',
      failed: value => ['Error', 'Failed'].includes(stringAt(value, 'status')),
      label: 'BFL',
    });
    const imageUrl = nestedString(result, ['result', 'sample']);
    if (!imageUrl) throw new Error('BFL 任务完成但未返回图片地址。');
    return this.imageFromUrl(imageUrl, settings.model, requestId, signal);
  }
}

export class OpenAICompatibleImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const endpoint = /\/images\/generations$/i.test(settings.baseUrl) ? settings.baseUrl : `${settings.baseUrl}/images/generations`;
    const response = await this.fetcher(endpoint, {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Bearer ${this.credential()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, prompt: requirePrompt(request.prompt), size: normalizedSize(request.size), response_format: 'url', n: 1 }),
    });
    rejectRedirect(response, this.options.provider);
    const payload = await readJson(response, signal);
    if (!response.ok) throw apiFailure(this.options.provider, response, payload);
    const first = Array.isArray(payload.data) ? payload.data[0] : null;
    const url = isRecord(first) && typeof first.url === 'string' ? first.url : '';
    const encoded = isRecord(first) && typeof first.b64_json === 'string' ? first.b64_json : '';
    if (encoded) return this.validated(Buffer.from(encoded, 'base64'), settings.model, response.headers.get('x-request-id'));
    if (url) return this.imageFromUrl(url, settings.model, response.headers.get('x-request-id'), signal);
    throw new Error(`${this.options.provider} 生图响应中没有可用图片。`);
  }
}

export class DashScopeImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const response = await this.fetcher(settings.baseUrl, {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Bearer ${this.credential()}`, 'X-DashScope-Async': 'enable', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, input: { prompt: requirePrompt(request.prompt) }, parameters: { style: '<auto>', size: dashScopeSize(request.size), n: 1 } }),
    });
    rejectRedirect(response, 'DashScope');
    const created = await readJson(response, signal);
    if (!response.ok) throw apiFailure('DashScope', response, created);
    const taskId = nestedString(created, ['output', 'task_id']);
    if (!taskId) throw new Error('通义万相未返回任务 ID。');
    const origin = new URL(settings.baseUrl).origin;
    const result = await pollJson(this.fetcher, `${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      signal,
      headers: { Authorization: `Bearer ${this.credential()}` },
      done: value => nestedString(value, ['output', 'task_status']) === 'SUCCEEDED',
      failed: value => ['FAILED', 'CANCELED', 'UNKNOWN'].includes(nestedString(value, ['output', 'task_status'])),
      label: 'DashScope',
    });
    const results = nestedValue(result, ['output', 'results']);
    const first = Array.isArray(results) ? results[0] : null;
    const imageUrl = isRecord(first) && typeof first.url === 'string' ? first.url : '';
    if (!imageUrl) throw new Error('通义万相任务完成但未返回图片地址。');
    return this.imageFromUrl(imageUrl, settings.model, stringAt(result, 'request_id') || taskId, signal);
  }
}

export class ReplicateImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const modelPath = settings.model.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    if (modelPath.split('/').length < 2) throw new Error('Replicate 模型名应为 owner/model。');
    const response = await this.fetcher(`${settings.baseUrl}/${modelPath}/predictions`, {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Bearer ${this.credential()}`, 'Content-Type': 'application/json', Prefer: 'wait=60', 'Cancel-After': '10m' },
      body: JSON.stringify({ input: { prompt: requirePrompt(request.prompt), aspect_ratio: aspectRatio(request.size), output_format: request.outputFormat } }),
    });
    rejectRedirect(response, 'Replicate');
    let prediction = await readJson(response, signal);
    if (!response.ok) throw apiFailure('Replicate', response, prediction);
    if (!['successful', 'succeeded'].includes(stringAt(prediction, 'status'))) {
      const getUrl = nestedString(prediction, ['urls', 'get']);
      if (!getUrl) throw new Error('Replicate 未返回任务轮询地址。');
      prediction = await pollJson(this.fetcher, getUrl, {
        signal,
        headers: { Authorization: `Bearer ${this.credential()}` },
        done: value => ['successful', 'succeeded'].includes(stringAt(value, 'status')),
        failed: value => ['failed', 'canceled'].includes(stringAt(value, 'status')),
        label: 'Replicate',
      });
    }
    const imageUrl = firstOutputUrl(prediction.output);
    if (!imageUrl) throw new Error('Replicate 任务完成但未返回图片地址。');
    return this.imageFromUrl(imageUrl, settings.model, stringAt(prediction, 'id') || null, signal, sanitizeUsage(prediction.metrics));
  }
}

export class FalImageGenerationProvider extends RemoteImageProviderBase {
  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.settings();
    const endpoint = `${settings.baseUrl}/${settings.model.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
    const response = await this.fetcher(endpoint, {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Key ${this.credential()}`, 'Content-Type': 'application/json', 'X-Fal-Store-IO': '0' },
      body: JSON.stringify({ prompt: requirePrompt(request.prompt), image_size: falImageSize(request.size), num_images: 1, output_format: request.outputFormat }),
    });
    rejectRedirect(response, 'fal.ai');
    const created = await readJson(response, signal);
    if (!response.ok) throw apiFailure('fal.ai', response, created);
    const responseUrl = stringAt(created, 'response_url');
    const statusUrl = stringAt(created, 'status_url');
    const requestId = stringAt(created, 'request_id') || null;
    if (!responseUrl || !statusUrl) throw new Error('fal.ai 未返回任务状态地址。');
    await pollJson(this.fetcher, statusUrl, {
      signal,
      headers: { Authorization: `Key ${this.credential()}` },
      done: value => stringAt(value, 'status') === 'COMPLETED',
      failed: value => ['FAILED', 'CANCELLED'].includes(stringAt(value, 'status')),
      label: 'fal.ai',
    });
    const resultResponse = await fetchSafeUrl(this.fetcher, responseUrl, signal, { Authorization: `Key ${this.credential()}` });
    const result = await readJson(resultResponse, signal);
    if (!resultResponse.ok) throw apiFailure('fal.ai', resultResponse, result);
    const images = Array.isArray(result.images) ? result.images : [];
    const imageUrl = isRecord(images[0]) && typeof images[0].url === 'string' ? images[0].url : '';
    if (!imageUrl) throw new Error('fal.ai 任务完成但未返回图片地址。');
    return this.imageFromUrl(imageUrl, settings.model, requestId, signal);
  }
}

interface PollOptions {
  signal: AbortSignal;
  headers: Record<string, string>;
  done: (value: Record<string, unknown>) => boolean;
  failed: (value: Record<string, unknown>) => boolean;
  label: string;
}

async function pollJson(fetcher: typeof fetch, url: string, options: PollOptions): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await delay(800, options.signal);
    const response = await fetchSafeUrl(fetcher, url, options.signal, options.headers);
    const payload = await readJson(response, options.signal);
    if (!response.ok) throw apiFailure(options.label, response, payload);
    if (options.failed(payload)) throw new Error(`${options.label} 生图任务失败：${safeMessage(payload)}`);
    if (options.done(payload)) return payload;
  }
  throw new Error(`${options.label} 生图任务等待超时。`);
}

async function fetchSafeUrl(fetcher: typeof fetch, rawUrl: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
  let current = assertPublicHttpsUrl(rawUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetcher(current, { method: 'GET', redirect: 'manual', signal, headers });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('图片下载遇到无效重定向。');
    current = assertPublicHttpsUrl(new URL(location, current).toString());
  }
  throw new Error('图片下载重定向次数过多。');
}

function assertPublicHttpsUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || host === 'localhost' || host === '::1' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error('Provider 返回了不安全的图片地址。');
  }
  const private172 = /^172\.(\d+)\./.exec(host);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) throw new Error('Provider 返回了私有网络图片地址。');
  return url.toString();
}

async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBytes(response, MAX_JSON_BYTES, signal);
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readBoundedBytes(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error('Provider 响应超过大小限制。');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('生图已取消。');
      const item = await reader.read();
      if (item.done) break;
      total += item.value.length;
      if (total > limit) throw new Error('Provider 响应超过大小限制。');
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function findBase64Image(value: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  if (isRecord(value)) {
    for (const key of ['data', 'b64_json', 'bytes']) {
      const item = value[key];
      if (typeof item === 'string' && item.length > 20 && /^[A-Za-z0-9+/]+={0,2}$/.test(item)) return item;
    }
    for (const item of Object.values(value)) {
      const found = findBase64Image(item, depth + 1);
      if (found) return found;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBase64Image(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function requirePrompt(value: string): string {
  const prompt = String(value || '').trim();
  if (!prompt || prompt.length > 32_000) throw new Error('生图提示词为空或过长。');
  return prompt;
}

function dimensions(size: ImageGenerationRequest['size']): { width: number; height: number } {
  if (size === 'auto') return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1024, height: 1024 };
}

function normalizedSize(size: ImageGenerationRequest['size']): string {
  return size === 'auto' ? '1024x1024' : size;
}

function aspectRatio(size: ImageGenerationRequest['size']): string {
  const { width, height } = dimensions(size);
  if (width === height) return '1:1';
  if (width > height) return width / height >= 1.7 ? '16:9' : '3:2';
  return height / width >= 1.7 ? '9:16' : '2:3';
}

function imageScale(size: ImageGenerationRequest['size']): string {
  const { width, height } = dimensions(size);
  return Math.max(width, height) >= 1800 ? '2K' : '1K';
}

function dashScopeSize(size: ImageGenerationRequest['size']): string {
  const { width, height } = dimensions(size);
  return `${width}*${height}`;
}

function falImageSize(size: ImageGenerationRequest['size']): string | { width: number; height: number } {
  if (size === 'auto' || size === '1024x1024') return 'square_hd';
  if (size === '1536x1024' || size === '2048x1152') return 'landscape_16_9';
  if (size === '1024x1536') return 'portrait_16_9';
  return dimensions(size);
}

function stabilityFormat(format: ImageOutputFormat): string {
  return format === 'jpeg' ? 'jpeg' : format;
}

function nestedValue(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return current;
}

function nestedString(value: Record<string, unknown>, path: string[]): string {
  const item = nestedValue(value, path);
  return typeof item === 'string' ? item : '';
}

function stringAt(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] as string : '';
}

function firstOutputUrl(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('https://')) return value;
  if (Array.isArray(value)) return value.map(firstOutputUrl).find(Boolean) || '';
  if (isRecord(value)) return typeof value.url === 'string' ? value.url : Object.values(value).map(firstOutputUrl).find(Boolean) || '';
  return '';
}

function sanitizeUsage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'number' || typeof item === 'string').slice(0, 20));
}

function safeMessage(payload: Record<string, unknown>): string {
  const message = typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : '未知错误';
  return message.slice(0, 500);
}

function apiFailure(label: string, response: Response, payload: Record<string, unknown>): Error {
  const nestedError = isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : '';
  return new Error(`${label} 生图失败（${response.status}）：${(nestedError || safeMessage(payload)).slice(0, 500)}`);
}

function rejectRedirect(response: Response, label: string): void {
  if (response.status >= 300 && response.status < 400) throw new Error(`${label} API 返回了意外重定向。`);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason instanceof Error ? signal.reason : new Error('生图已取消。'));
    };
    signal.addEventListener('abort', abort, { once: true });
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
