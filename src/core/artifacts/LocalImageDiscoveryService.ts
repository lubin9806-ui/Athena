import * as fs from 'fs';
import * as path from 'path';
import type {
  DiscoveredLocalImageModel,
  ImageGenerationSettings,
  LocalImageDiscoverySnapshot,
} from '../../shared/types';

const MODEL_EXTENSIONS = new Set<DiscoveredLocalImageModel['format']>(['.safetensors', '.gguf', '.ckpt', '.pth', '.pt']);
const MAX_DISCOVERED_MODELS = 500;
const MAX_VISITED_ENTRIES = 20_000;

export class LocalImageDiscoveryService {
  private cached: LocalImageDiscoverySnapshot | null = null;

  snapshot(): LocalImageDiscoverySnapshot | null {
    return this.cached ? structuredClone(this.cached) : null;
  }

  async refresh(settings: ImageGenerationSettings, signal: AbortSignal = AbortSignal.timeout(8_000)): Promise<LocalImageDiscoverySnapshot> {
    const [models, comfyui] = await Promise.all([
      Promise.resolve(discoverLocalModels(settings.local.modelPath, signal)),
      discoverComfyUI(settings.local.comfyuiBaseUrl, signal),
    ]);
    const installation = discoverInstalledComfyUI(models);
    this.cached = { scannedAt: new Date().toISOString(), models, comfyui: { ...installation, ...comfyui } };
    return structuredClone(this.cached);
  }
}

export function discoverInstalledComfyUI(models: DiscoveredLocalImageModel[]): Pick<
  LocalImageDiscoverySnapshot['comfyui'],
  'installed' | 'launchable' | 'launcherLabel' | 'installedModelCount' | 'installedWorkflows'
> {
  const comfyModels = models.filter(model => model.source === 'comfyui');
  const installedWorkflows: LocalImageDiscoverySnapshot['comfyui']['installedWorkflows'] = [];
  if (comfyModels.some(model => model.role === 'checkpoint' && model.standaloneCompatible)) installedWorkflows.push('checkpoint');
  if (
    hasNamedDiscoveredModel(comfyModels, 'diffusion-model', 'z_image_turbo_bf16.safetensors')
    && hasNamedDiscoveredModel(comfyModels, 'text-encoder', 'qwen_3_4b.safetensors')
    && hasNamedDiscoveredModel(comfyModels, 'vae', 'ae.safetensors')
  ) installedWorkflows.push('z-image-turbo');
  const launcher = findComfyUILaunchTarget();
  return {
    installed: comfyModels.length > 0 || Boolean(launcher),
    launchable: Boolean(launcher),
    launcherLabel: launcher?.label,
    installedModelCount: comfyModels.length,
    installedWorkflows,
  };
}

export function findComfyUILaunchTarget(): { path: string; label: string } | null {
  const userRoot = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || (userRoot ? path.join(userRoot, 'AppData', 'Roaming') : '');
  const localAppData = process.env.LOCALAPPDATA || (userRoot ? path.join(userRoot, 'AppData', 'Local') : '');
  const candidates: Array<{ path: string; label: string }> = [
    { path: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Comfy Desktop.lnk'), label: 'Comfy Desktop' },
    { path: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ComfyUI.lnk'), label: 'ComfyUI' },
    { path: path.join(localAppData, 'Programs', 'ComfyUI', 'ComfyUI.exe'), label: 'ComfyUI' },
    { path: path.join(localAppData, 'Programs', 'Comfy Desktop', 'Comfy Desktop.exe'), label: 'Comfy Desktop' },
  ];
  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (!safeDirectoryExists(drive)) continue;
      candidates.push(
        { path: path.join(drive, 'ai', 'Comfy Desktop', 'Comfy Desktop.exe'), label: 'Comfy Desktop' },
        { path: path.join(drive, 'Comfy Desktop', 'Comfy Desktop.exe'), label: 'Comfy Desktop' },
      );
    }
  }
  return candidates.find(candidate => safeFileExists(candidate.path)) ?? null;
}

export async function waitForComfyUIConnection(
  configuredBaseUrl: string,
  timeoutMs = 90_000,
): Promise<string | null> {
  const candidates = Array.from(new Set([
    normalizeComfyBaseUrl(configuredBaseUrl),
    'http://127.0.0.1:8188',
    'http://127.0.0.1:8189',
    'http://127.0.0.1:8190',
  ].filter(Boolean)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const baseUrl of candidates) {
      try {
        const response = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(1_500), redirect: 'error' });
        if (response.ok) return baseUrl;
      } catch { /* The desktop app is still starting. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  return null;
}

export function discoverLocalModels(configuredModelPath = '', signal?: AbortSignal): DiscoveredLocalImageModel[] {
  const roots = candidateModelRoots(configuredModelPath);
  const output: DiscoveredLocalImageModel[] = [];
  const seen = new Set<string>();
  let visited = 0;
  for (const candidate of roots) {
    if (signal?.aborted || output.length >= MAX_DISCOVERED_MODELS || visited >= MAX_VISITED_ENTRIES) break;
    const queue: Array<{ directory: string; depth: number }> = [{ directory: candidate.root, depth: 0 }];
    while (queue.length > 0 && output.length < MAX_DISCOVERED_MODELS && visited < MAX_VISITED_ENTRIES) {
      if (signal?.aborted) break;
      const current = queue.shift();
      if (!current) break;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        visited += 1;
        if (visited >= MAX_VISITED_ENTRIES || output.length >= MAX_DISCOVERED_MODELS) break;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < candidate.depth && !shouldSkipDirectory(entry.name)) queue.push({ directory: fullPath, depth: current.depth + 1 });
          continue;
        }
        const format = path.extname(entry.name).toLowerCase() as DiscoveredLocalImageModel['format'];
        if (!MODEL_EXTENSIONS.has(format)) continue;
        let stat: fs.Stats;
        try { stat = fs.lstatSync(fullPath); } catch { continue; }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1024 * 1024 || stat.size > 40 * 1024 * 1024 * 1024) continue;
        const normalized = process.platform === 'win32' ? path.resolve(fullPath).toLowerCase() : path.resolve(fullPath);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const role = classifyModelRole(fullPath);
        output.push({
          name: entry.name,
          path: path.resolve(fullPath),
          format,
          source: classifyModelSource(fullPath),
          bytes: stat.size,
          role,
          standaloneCompatible: isStandaloneCompatible(fullPath, format, role),
        });
      }
    }
  }
  return output.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

type LiveComfyUIDiscovery = Omit<
  LocalImageDiscoverySnapshot['comfyui'],
  'installed' | 'launchable' | 'launcherLabel' | 'installedModelCount' | 'installedWorkflows'
>;

async function discoverComfyUI(configuredBaseUrl: string, signal: AbortSignal): Promise<LiveComfyUIDiscovery> {
  const candidates = Array.from(new Set([
    normalizeComfyBaseUrl(configuredBaseUrl),
    'http://127.0.0.1:8188',
    'http://127.0.0.1:8189',
    'http://127.0.0.1:8190',
  ].filter(Boolean)));
  let lastError = '没有发现正在运行的 ComfyUI。';
  for (const baseUrl of candidates) {
    if (signal.aborted) break;
    try {
      const health = await fetch(`${baseUrl}/system_stats`, { signal: boundedSignal(signal, 1_500), redirect: 'error' });
      if (!health.ok) throw new Error(`HTTP ${health.status}`);
      await readBoundedJson(health, 512 * 1024);
      const [checkpoints, diffusionModels, textEncoders, vaes] = await Promise.all([
        fetchComfyChoices(baseUrl, 'CheckpointLoaderSimple', 'ckpt_name', signal),
        fetchComfyChoices(baseUrl, 'UNETLoader', 'unet_name', signal),
        fetchComfyChoices(baseUrl, 'CLIPLoader', 'clip_name', signal),
        fetchComfyChoices(baseUrl, 'VAELoader', 'vae_name', signal),
      ]);
      const workflows: LocalImageDiscoverySnapshot['comfyui']['workflows'] = [];
      if (checkpoints.length > 0) workflows.push('checkpoint');
      if (
        hasNamedModel(diffusionModels, 'z_image_turbo_bf16.safetensors')
        && hasNamedModel(textEncoders, 'qwen_3_4b.safetensors')
        && hasNamedModel(vaes, 'ae.safetensors')
      ) workflows.push('z-image-turbo');
      return { connected: true, baseUrl, checkpoints, diffusionModels, textEncoders, vaes, workflows };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    connected: false,
    baseUrl: normalizeComfyBaseUrl(configuredBaseUrl) || 'http://127.0.0.1:8188',
    checkpoints: [],
    diffusionModels: [],
    textEncoders: [],
    vaes: [],
    workflows: [],
    error: lastError,
  };
}

function candidateModelRoots(configuredModelPath: string): Array<{ root: string; depth: number }> {
  const userRoot = process.env.USERPROFILE || process.env.HOME || '';
  const roots: Array<{ root: string; depth: number }> = [];
  const add = (root: string, depth: number) => { if (root) roots.push({ root: path.resolve(root), depth }); };
  if (configuredModelPath.trim()) add(path.dirname(path.resolve(configuredModelPath.trim())), 0);
  add(path.resolve(process.cwd(), 'models', 'image'), 2);
  if (userRoot) {
    add(path.join(userRoot, 'ComfyUI', 'models', 'checkpoints'), 2);
    add(path.join(userRoot, 'Documents', 'ComfyUI', 'models', 'checkpoints'), 2);
    add(path.join(userRoot, 'stable-diffusion-webui', 'models', 'Stable-diffusion'), 1);
    add(path.join(userRoot, 'stable-diffusion-webui-forge', 'models', 'Stable-diffusion'), 1);
    add(path.join(userRoot, 'StabilityMatrix', 'Data', 'Models', 'StableDiffusion'), 2);
    add(path.join(userRoot, 'Fooocus', 'models', 'checkpoints'), 1);
    add(path.join(userRoot, 'Downloads'), 2);
  }
  for (let code = 67; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (!safeDirectoryExists(drive)) continue;
    add(path.join(drive, 'ComfyUI', 'models', 'checkpoints'), 2);
    add(path.join(drive, 'Comfy-Desktop', 'ComfyUI-Installs'), 6);
    add(path.join(drive, 'Comfy-Desktop', 'ComfyUI-Shared', 'models'), 2);
    add(path.join(drive, 'StabilityMatrix', 'Data', 'Models', 'StableDiffusion'), 2);
    add(path.join(drive, 'stable-diffusion-webui', 'models', 'Stable-diffusion'), 1);
    add(path.join(drive, 'stable-diffusion-webui-forge', 'models', 'Stable-diffusion'), 1);
    add(path.join(drive, 'Fooocus', 'models', 'checkpoints'), 1);
  }
  const unique = new Map<string, { root: string; depth: number }>();
  for (const item of roots) {
    const key = process.platform === 'win32' ? item.root.toLowerCase() : item.root;
    if (!unique.has(key) && safeDirectoryExists(item.root)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

function classifyModelSource(filePath: string): DiscoveredLocalImageModel['source'] {
  const value = filePath.toLowerCase();
  if (value.includes('comfy')) return 'comfyui';
  if (value.includes('stabilitymatrix')) return 'stability-matrix';
  if (value.includes('automatic1111') || value.includes('stable-diffusion-webui')) return 'automatic1111';
  if (value.includes('forge')) return 'forge';
  if (value.includes('fooocus')) return 'fooocus';
  if (value.includes(`${path.sep}athena${path.sep}`) || value.includes(`${path.sep}models${path.sep}image`)) return 'athena';
  return 'other';
}

function extractComfyChoices(payload: unknown, nodeName: string, inputName: string): string[] {
  if (!isRecord(payload)) return [];
  const node = isRecord(payload[nodeName]) ? payload[nodeName] : payload;
  const input = isRecord(node.input) ? node.input : {};
  const required = isRecord(input.required) ? input.required : {};
  const value = required[inputName];
  const choices = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : [];
  return choices.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 500).slice(0, 500);
}

async function fetchComfyChoices(baseUrl: string, nodeName: string, inputName: string, signal: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/object_info/${encodeURIComponent(nodeName)}`, {
      signal: boundedSignal(signal, 2_500),
      redirect: 'error',
    });
    if (!response.ok) return [];
    return extractComfyChoices(await readBoundedJson(response, 4 * 1024 * 1024), nodeName, inputName);
  } catch {
    return [];
  }
}

function hasNamedModel(models: string[], expectedName: string): boolean {
  return models.some(model => path.basename(model).toLowerCase() === expectedName.toLowerCase());
}

function hasNamedDiscoveredModel(
  models: DiscoveredLocalImageModel[],
  role: DiscoveredLocalImageModel['role'],
  expectedName: string,
): boolean {
  return models.some(model => model.role === role && model.name.toLowerCase() === expectedName.toLowerCase());
}

function classifyModelRole(filePath: string): DiscoveredLocalImageModel['role'] {
  const segments = path.resolve(filePath).toLowerCase().split(/[\\/]+/);
  if (segments.includes('checkpoints') || segments.includes('stable-diffusion')) return 'checkpoint';
  if (segments.some((segment, index) => segment === 'models' && segments[index + 1] === 'image')) return 'checkpoint';
  if (segments.includes('diffusion_models') || segments.includes('unet')) return 'diffusion-model';
  if (segments.includes('text_encoders') || segments.includes('clip')) return 'text-encoder';
  if (segments.includes('vae')) return 'vae';
  return 'unknown';
}

function isStandaloneCompatible(
  filePath: string,
  format: DiscoveredLocalImageModel['format'],
  role: DiscoveredLocalImageModel['role'],
): boolean {
  if (role !== 'checkpoint') return false;
  if (format === '.gguf' || format === '.ckpt') return true;
  if (format !== '.safetensors') return false;
  return hasFullCheckpointTensorFamilies(filePath);
}

function hasFullCheckpointTensorFamilies(filePath: string): boolean {
  let handle: number | undefined;
  try {
    handle = fs.openSync(filePath, 'r');
    const lengthBytes = Buffer.allocUnsafe(8);
    if (fs.readSync(handle, lengthBytes, 0, 8, 0) !== 8) return false;
    const headerLength = Number(lengthBytes.readBigUInt64LE(0));
    if (!Number.isSafeInteger(headerLength) || headerLength <= 2 || headerLength > 16 * 1024 * 1024) return false;
    const header = Buffer.allocUnsafe(headerLength);
    if (fs.readSync(handle, header, 0, headerLength, 8) !== headerLength) return false;
    const text = header.toString('utf8').toLowerCase();
    const hasDenoiser = text.includes('model.diffusion_model.') || text.includes('diffusion_model.') || text.includes('unet.');
    const hasTextEncoder = text.includes('cond_stage_model.') || text.includes('conditioner.embedders.') || text.includes('text_encoder.');
    const hasVae = text.includes('first_stage_model.') || text.includes('vae.decoder.') || text.includes('decoder.up_blocks.');
    return hasDenoiser && hasTextEncoder && hasVae;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

async function readBoundedJson(response: Response, maxChars: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxChars) throw new Error('ComfyUI 响应超过安全上限。');
  return text ? JSON.parse(text) : {};
}

function boundedSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
}

function normalizeComfyBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase())) return '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}

function shouldSkipDirectory(name: string): boolean {
  return /^(?:node_modules|\.git|release|dist|cache|temp|tmp|outputs?|input|venv|python_embeded)$/i.test(name);
}

function safeDirectoryExists(directory: string): boolean {
  try {
    const stat = fs.lstatSync(directory);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function safeFileExists(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
