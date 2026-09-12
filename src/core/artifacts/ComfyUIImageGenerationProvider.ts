import * as crypto from 'crypto';
import * as path from 'path';
import type { LocalImageDiscoverySnapshot } from '../../shared/types';
import { comfyNotRunningMessage, comfyUnresponsiveMessage } from './LocalImageDiscoveryService';
import {
  inspectImage,
  type GeneratedImage,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
} from './OpenAIImageGenerationProvider';

export interface ComfyUIImageGenerationProviderOptions {
  baseUrl: string;
  checkpoint: string;
  discoveryResolver: (signal: AbortSignal) => Promise<LocalImageDiscoverySnapshot>;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
  fetcher?: typeof fetch;
}

export class ComfyUIImageGenerationProvider implements ImageGenerationProvider {
  constructor(private readonly options: ComfyUIImageGenerationProviderOptions) {}

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const discovery = await this.options.discoveryResolver(signal);
    if (!discovery.comfyui.connected) {
      if (discovery.comfyui.reachability === 'unresponsive') throw new Error(comfyUnresponsiveMessage(discovery.comfyui.baseUrl));
      if (discovery.comfyui.launchable) throw new Error(`ComfyUI 没有在运行。打开 ${discovery.comfyui.launcherLabel || 'ComfyUI'} 之后再试一次。`);
      throw new Error(comfyNotRunningMessage());
    }
    const baseUrl = normalizeLocalBaseUrl(discovery.comfyui.baseUrl || this.options.baseUrl);
    const explicitCheckpoint = this.options.checkpoint.trim();
    const useZImageTurbo = !explicitCheckpoint && discovery.comfyui.workflows.includes('z-image-turbo');
    const checkpoint = explicitCheckpoint || discovery.comfyui.checkpoints[0] || '';
    if (!useZImageTurbo && !checkpoint) throw new Error('ComfyUI 没有发现可直接使用的完整 checkpoint 或受支持的拆分模型工作流。');
    const { width, height } = dimensions(request.size, request.quality);
    const profile = useZImageTurbo
      ? { steps: 8, cfg: 1 }
      : request.quality === 'high' ? { steps: 24, cfg: 7 } : request.quality === 'medium' ? { steps: 12, cfg: 5 } : { steps: 4, cfg: 1 };
    const clientId = crypto.randomUUID();
    const workflow = useZImageTurbo
      ? buildZImageTurboWorkflow(request.prompt, discovery, width, height, profile.steps)
      : buildCheckpointWorkflow(request.prompt, checkpoint, width, height, profile.steps, profile.cfg);
    const fetcher = this.options.fetcher ?? fetch;
    const submitted = await localFetch(fetcher, `${baseUrl}/prompt`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const submitPayload = await readJson(submitted, 2 * 1024 * 1024);
    if (!submitted.ok) throw new Error(`ComfyUI 提交失败（${submitted.status}）：${extractServerMessage(submitPayload) || '请检查工作流与模型。'}`);
    const nodeErrors = isRecord(submitPayload) && isRecord(submitPayload.node_errors) ? Object.keys(submitPayload.node_errors) : [];
    if (nodeErrors.length > 0) throw new Error(`ComfyUI 拒绝了工作流，错误节点：${nodeErrors.join(', ')}。`);
    const promptId = isRecord(submitPayload) && typeof submitPayload.prompt_id === 'string' ? submitPayload.prompt_id : '';
    if (!promptId) throw new Error('ComfyUI 没有返回 prompt_id。');
    const imageRef = await pollOutput(fetcher, baseUrl, promptId, signal);
    const query = new URLSearchParams({ filename: imageRef.filename, subfolder: imageRef.subfolder, type: imageRef.type });
    const response = await localFetch(fetcher, `${baseUrl}/view?${query.toString()}`, { redirect: 'error', signal });
    if (!response.ok) throw new Error(`ComfyUI 图片读取失败（${response.status}）。`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length <= 0 || bytes.length > 50 * 1024 * 1024) throw new Error('ComfyUI 图片大小超出安全范围。');
    const inspected = inspectImage(bytes);
    const decoded = this.options.decodeValidator(bytes);
    if (inspected.width !== decoded.width || inspected.height !== decoded.height) throw new Error('ComfyUI 图片解码尺寸不一致。');
    return {
      bytes,
      format: inspected.format,
      width: inspected.width,
      height: inspected.height,
      provider: 'local',
      model: useZImageTurbo ? 'Z-Image Turbo (split components)' : checkpoint,
      requestId: promptId,
      usage: { engine: 'comfyui', workflow: useZImageTurbo ? 'z-image-turbo' : 'checkpoint', baseUrl, steps: profile.steps, cfgScale: profile.cfg },
    };
  }
}

function buildCheckpointWorkflow(prompt: string, checkpoint: string, width: number, height: number, steps: number, cfg: number): Record<string, unknown> {
  return {
    '3': { class_type: 'KSampler', inputs: { seed: crypto.randomInt(0, 2_147_483_647), steps, cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'Athena', images: ['8', 0] } },
  };
}

function buildZImageTurboWorkflow(
  prompt: string,
  discovery: LocalImageDiscoverySnapshot,
  width: number,
  height: number,
  steps: number,
): Record<string, unknown> {
  const unet = namedModel(discovery.comfyui.diffusionModels, 'z_image_turbo_bf16.safetensors');
  const clip = namedModel(discovery.comfyui.textEncoders, 'qwen_3_4b.safetensors');
  const vae = namedModel(discovery.comfyui.vaes, 'ae.safetensors');
  if (!unet || !clip || !vae) throw new Error('Z-Image Turbo 工作流缺少 UNET、Qwen 文本编码器或 VAE。');
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '7': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '8': { class_type: 'KSampler', inputs: { seed: crypto.randomInt(0, 2_147_483_647), steps, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1, model: ['7', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0] } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'Athena-ZImage', images: ['9', 0] } },
  };
}

function namedModel(models: string[], expectedName: string): string {
  return models.find(model => path.basename(model).toLowerCase() === expectedName.toLowerCase()) || '';
}

async function pollOutput(fetcher: typeof fetch, baseUrl: string, promptId: string, signal: AbortSignal): Promise<{ filename: string; subfolder: string; type: string }> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('ComfyUI 生图已取消。');
    const response = await localFetch(fetcher, `${baseUrl}/history/${encodeURIComponent(promptId)}`, { redirect: 'error', signal });
    const payload = await readJson(response, 4 * 1024 * 1024);
    if (!response.ok) throw new Error(`ComfyUI 状态读取失败（${response.status}）。`);
    const executionError = extractExecutionError(payload, promptId);
    if (executionError) throw new Error(`ComfyUI 执行失败：${executionError}`);
    const ref = extractImageRef(payload, promptId);
    if (ref) return ref;
    await delay(1_000, signal);
  }
  throw new Error('ComfyUI 生图等待超时。');
}

function extractExecutionError(payload: unknown, promptId: string): string {
  if (!isRecord(payload)) return '';
  const history = isRecord(payload[promptId]) ? payload[promptId] : Object.values(payload).find(isRecord);
  if (!isRecord(history) || !isRecord(history.status)) return '';
  const status = history.status;
  if (status.status_str !== 'error') return '';
  if (Array.isArray(status.messages)) {
    for (const message of status.messages) {
      if (!Array.isArray(message) || message[0] !== 'execution_error' || !isRecord(message[1])) continue;
      const detail = message[1];
      const nodeType = typeof detail.node_type === 'string' ? detail.node_type : '';
      const reason = typeof detail.exception_message === 'string' ? detail.exception_message : '';
      if (nodeType || reason) return [nodeType, reason].filter(Boolean).join('：').slice(0, 1_000);
    }
  }
  return '工作流执行出错，请检查 ComfyUI 日志。';
}

function extractImageRef(payload: unknown, promptId: string): { filename: string; subfolder: string; type: string } | null {
  if (!isRecord(payload)) return null;
  const history = isRecord(payload[promptId]) ? payload[promptId] : Object.values(payload).find(isRecord);
  if (!isRecord(history) || !isRecord(history.outputs)) return null;
  for (const output of Object.values(history.outputs)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue;
    for (const item of output.images) {
      if (!isRecord(item) || typeof item.filename !== 'string') continue;
      return { filename: item.filename.slice(0, 500), subfolder: typeof item.subfolder === 'string' ? item.subfolder.slice(0, 500) : '', type: typeof item.type === 'string' ? item.type.slice(0, 40) : 'output' };
    }
  }
  return null;
}

async function readJson(response: Response, maxChars: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxChars) throw new Error('ComfyUI 响应超过安全上限。');
  return text ? JSON.parse(text) : {};
}

function normalizeLocalBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase())) throw new Error('ComfyUI 地址只允许本机回环地址。');
  return url.toString().replace(/\/$/, '');
}

function dimensions(size: ImageGenerationRequest['size'], quality: ImageGenerationRequest['quality']): { width: number; height: number } {
  if (quality === 'low') {
    if (size === '1536x1024') return { width: 768, height: 512 };
    if (size === '1024x1536') return { width: 512, height: 768 };
    return { width: 512, height: 512 };
  }
  if (size === 'auto') return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1024, height: 1024 };
}

async function localFetch(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接本机 ComfyUI（${new URL(url).origin}）：${detail}`);
  }
}

function extractServerMessage(payload: unknown): string {
  if (!isRecord(payload)) return '';
  if (typeof payload.error === 'string') return payload.error.slice(0, 1_000);
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message.slice(0, 1_000);
  return '';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason instanceof Error ? signal.reason : new Error('ComfyUI 生图已取消。')); };
    signal.addEventListener('abort', abort, { once: true });
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
