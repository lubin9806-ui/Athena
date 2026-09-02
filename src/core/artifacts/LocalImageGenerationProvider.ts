import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ImageGenerationSettings, LocalImageRuntimeStatus } from '../../shared/types';
import {
  inspectImage,
  type GeneratedImage,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
} from './OpenAIImageGenerationProvider';

export interface LocalImageGenerationProviderOptions {
  settingsResolver: () => ImageGenerationSettings;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
}

export class LocalImageGenerationProvider implements ImageGenerationProvider {
  constructor(private readonly options: LocalImageGenerationProviderOptions) {}

  status(): LocalImageRuntimeStatus {
    return getLocalImageRuntimeStatus(this.options.settingsResolver());
  }

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.options.settingsResolver();
    const status = getLocalImageRuntimeStatus(settings);
    if (!status.ready) throw new Error(status.message);
    const prompt = String(request.prompt || '').trim();
    if (!prompt || prompt.length > 32_000) throw new Error('本地生图提示词为空或过长。');
    const { width, height } = resolveDimensions(request.size);
    const profile = resolveProfile(settings);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-image-'));
    const outputPath = path.join(scratch, 'generated.png');
    try {
      const backend = settings.local.backend === 'cuda'
        ? 'cuda0'
        : settings.local.backend === 'vulkan'
          ? 'vulkan0'
          : settings.local.backend;
      const args = [
        '-m', status.modelPath,
        '-p', prompt,
        '-o', outputPath,
        '-W', String(width),
        '-H', String(height),
        '--steps', String(profile.steps),
        '--cfg-scale', String(profile.cfgScale),
        '--backend', backend,
        '--vae-tiling',
      ];
      if (profile.steps <= 8) args.push('--sampling-method', 'euler');
      await runLocalProcess(status.runtimePath, args, signal);
      const bytes = fs.readFileSync(outputPath);
      const inspected = inspectImage(bytes);
      const decoded = this.options.decodeValidator(bytes);
      if (inspected.format !== 'png' || inspected.width !== decoded.width || inspected.height !== decoded.height) {
        throw new Error('本地引擎输出的图片校验失败。');
      }
      return {
        bytes,
        format: 'png',
        width: inspected.width,
        height: inspected.height,
        provider: 'local',
        model: path.basename(status.modelPath),
        requestId: null,
        usage: { backend: settings.local.backend, steps: profile.steps, cfgScale: profile.cfgScale },
      };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

export function getLocalImageRuntimeStatus(settings: ImageGenerationSettings): LocalImageRuntimeStatus {
  const runtimePath = resolveRuntimePath(settings.local.runtimePath);
  const modelPath = resolveModelPath(settings.local.modelPath);
  const runtimeConfigured = isRegularFile(runtimePath, ['.exe']);
  const modelConfigured = isRegularFile(modelPath, ['.safetensors', '.gguf', '.ckpt', '.pth', '.pt']);
  const ready = runtimeConfigured && modelConfigured;
  const message = ready
    ? 'Athena 本地生图引擎已就绪。'
    : !runtimeConfigured
      ? '尚未安装或选择 Athena 独立生图引擎；也可在本地连接模式中选择或自动连接 ComfyUI。'
      : '尚未选择本地生图模型文件。';
  return {
    runtimeConfigured,
    modelConfigured,
    ready,
    runtimePath,
    modelPath,
    backend: settings.local.backend,
    message,
  };
}

function resolveRuntimePath(configured: string): string {
  if (configured.trim()) return path.resolve(configured.trim());
  const root = app?.isPackaged ? process.resourcesPath : path.resolve(process.cwd(), 'resources');
  return path.join(root, 'image-runtime', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');
}

function resolveModelPath(configured: string): string {
  if (configured.trim()) return path.resolve(configured.trim());
  if (app?.isReady?.()) return path.join(app.getPath('userData'), 'image-models', 'athena-fast.safetensors');
  return path.resolve(process.cwd(), 'models', 'image', 'athena-fast.safetensors');
}

function isRegularFile(filePath: string, extensions: string[]): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() && extensions.includes(path.extname(filePath).toLowerCase());
  } catch {
    return false;
  }
}

function resolveDimensions(size: ImageGenerationRequest['size']): { width: number; height: number } {
  if (size === 'auto') return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveProfile(settings: ImageGenerationSettings): { steps: number; cfgScale: number } {
  if (settings.local.profile === 'fast') return { steps: 4, cfgScale: 1 };
  if (settings.local.profile === 'balanced') return { steps: 12, cfgScale: 5 };
  if (settings.local.profile === 'quality') return { steps: 24, cfgScale: 7 };
  return { steps: settings.local.steps, cfgScale: settings.local.cfgScale };
}

function runLocalProcess(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrBytes = 0;
    child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
    const abort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', error => {
      signal.removeEventListener('abort', abort);
      reject(new Error(`Athena 本地生图引擎无法启动：${error.message}`));
    });
    child.once('exit', code => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason instanceof Error ? signal.reason : new Error('本地生图已取消。'));
      else if (code === 0) resolve();
      else reject(new Error(`Athena 本地生图引擎执行失败（退出码 ${code ?? 'unknown'}，诊断字节 ${stderrBytes}）。`));
    });
  });
}
