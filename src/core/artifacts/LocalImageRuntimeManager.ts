import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { app } from 'electron';
import type {
  LocalImageRuntimeInstallProgress,
  LocalImageRuntimeInstallResult,
  LocalImageRuntimeVariant,
  LocalImageRuntimeVariantId,
} from '../../shared/types';

interface RuntimeManifest {
  schemaVersion: number;
  engine: string;
  executable: string;
  releaseTag: string;
  variants: LocalImageRuntimeVariant[];
}

export interface LocalImageRuntimeManagerOptions {
  manifestPath?: string;
  installBase?: string;
  fetcher?: typeof fetch;
}

export class LocalImageRuntimeManager {
  private installing = false;

  constructor(private readonly options: LocalImageRuntimeManagerOptions = {}) {}

  variants(): LocalImageRuntimeVariant[] {
    return this.manifest().variants.map(variant => ({ ...variant }));
  }

  async install(
    variantId: LocalImageRuntimeVariantId,
    onProgress: (progress: LocalImageRuntimeInstallProgress) => void = () => undefined,
    signal: AbortSignal = AbortSignal.timeout(30 * 60_000),
  ): Promise<LocalImageRuntimeInstallResult> {
    const manifest = this.manifest();
    const variant = manifest.variants.find(item => item.id === variantId);
    if (!variant) throw new Error('未知的本地生图运行时版本。');
    if (this.installing) throw new Error('已有本地生图运行时正在安装。');
    this.installing = true;
    let releaseRoot = '';
    let stagingRoot = '';
    try {
      const installBase = path.resolve(this.options.installBase || path.join(app.getPath('userData'), 'image-runtimes'));
      releaseRoot = path.join(installBase, safeSegment(manifest.releaseTag));
      const finalRoot = path.join(releaseRoot, safeSegment(variant.id));
      const existingRuntime = verifiedExistingRuntime(finalRoot, manifest, variant);
      if (existingRuntime) {
        onProgress(progressFor(variant, 'complete', variant.downloadBytes, variant.downloadBytes, '已使用现有的校验版本。'));
        return { variant: variant.id, backend: variant.backend, runtimePath: existingRuntime, installRoot: finalRoot, reused: true };
      }
      fs.mkdirSync(releaseRoot, { recursive: true });
      assertContained(installBase, releaseRoot);
      stagingRoot = fs.mkdtempSync(path.join(releaseRoot, `.install-${safeSegment(variant.id)}-`));
      const archivePath = path.join(stagingRoot, variant.archiveName);
      const extractedRoot = path.join(stagingRoot, 'extracted');
      onProgress(progressFor(variant, 'preparing', 0, variant.downloadBytes, '正在准备官方运行时下载…'));
      await this.downloadAndVerify(variant, archivePath, onProgress, signal);
      onProgress(progressFor(variant, 'extracting', variant.downloadBytes, variant.downloadBytes, '校验通过，正在解压运行时…'));
      fs.mkdirSync(extractedRoot, { recursive: true });
      await extractZip(archivePath, extractedRoot, signal);
      const extractedExecutable = findExecutable(extractedRoot, manifest.executable);
      if (!extractedExecutable) throw new Error(`官方压缩包中没有找到 ${manifest.executable}。`);
      if (fs.existsSync(finalRoot)) removeManagedTree(installBase, finalRoot);
      fs.renameSync(extractedRoot, finalRoot);
      const runtimePath = findExecutable(finalRoot, manifest.executable);
      if (!runtimePath) throw new Error('运行时安装完成后未能定位可执行文件。');
      writeInstallReceipt(finalRoot, runtimePath, manifest, variant);
      onProgress(progressFor(variant, 'complete', variant.downloadBytes, variant.downloadBytes, 'Athena 独立生图引擎已安装。'));
      return { variant: variant.id, backend: variant.backend, runtimePath, installRoot: finalRoot, reused: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress(progressFor(variant, signal.aborted ? 'cancelled' : 'failed', 0, variant.downloadBytes, message));
      throw error;
    } finally {
      if (releaseRoot && stagingRoot) removeManagedTree(releaseRoot, stagingRoot);
      this.installing = false;
    }
  }

  private manifest(): RuntimeManifest {
    const manifestPath = path.resolve(this.options.manifestPath || defaultManifestPath());
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<RuntimeManifest>;
    if (parsed.schemaVersion !== 1 || parsed.engine !== 'stable-diffusion.cpp' || parsed.executable !== 'sd-cli.exe' || !parsed.releaseTag || !Array.isArray(parsed.variants)) {
      throw new Error('本地生图运行时清单无效。');
    }
    const ids = new Set<LocalImageRuntimeVariantId>();
    for (const item of parsed.variants) {
      if (!item || !['cuda12', 'vulkan', 'cpu'].includes(item.id) || ids.has(item.id)) throw new Error('运行时清单包含无效或重复版本。');
      if (!['cuda', 'vulkan', 'cpu'].includes(item.backend) || !Number.isSafeInteger(item.downloadBytes) || item.downloadBytes <= 0) throw new Error('运行时清单版本元数据无效。');
      if (!/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('运行时清单缺少有效 SHA-256。');
      const url = new URL(item.downloadUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('运行时下载必须来自固定的 GitHub 官方地址。');
      if (path.basename(item.archiveName) !== item.archiveName || !item.archiveName.toLowerCase().endsWith('.zip')) throw new Error('运行时压缩包名称无效。');
      ids.add(item.id);
    }
    return parsed as RuntimeManifest;
  }

  private async downloadAndVerify(
    variant: LocalImageRuntimeVariant,
    destination: string,
    onProgress: (progress: LocalImageRuntimeInstallProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await (this.options.fetcher ?? fetch)(variant.downloadUrl, { signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`官方运行时下载失败（HTTP ${response.status}）。`);
    const file = fs.openSync(destination, 'wx');
    const hash = crypto.createHash('sha256');
    const reader = response.body.getReader();
    let downloaded = 0;
    let lastReportedAt = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = Buffer.from(result.value);
        writeAll(file, chunk);
        hash.update(chunk);
        downloaded += chunk.length;
        if (downloaded > variant.downloadBytes + 1024 * 1024) throw new Error('运行时下载大小超过清单上限。');
        if (Date.now() - lastReportedAt >= 250) {
          onProgress(progressFor(variant, 'downloading', downloaded, variant.downloadBytes, '正在下载官方运行时…'));
          lastReportedAt = Date.now();
        }
      }
    } finally {
      fs.closeSync(file);
    }
    if (downloaded !== variant.downloadBytes) throw new Error(`运行时下载不完整（${downloaded}/${variant.downloadBytes} 字节）。`);
    onProgress(progressFor(variant, 'verifying', downloaded, variant.downloadBytes, '正在校验 SHA-256…'));
    if (hash.digest('hex').toLowerCase() !== variant.sha256.toLowerCase()) throw new Error('运行时 SHA-256 校验失败，文件已拒绝安装。');
  }
}

function defaultManifestPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'image-runtime', 'runtime-manifest.json')
    : path.resolve(process.cwd(), 'resources', 'image-runtime', 'runtime-manifest.json');
}

function progressFor(
  variant: LocalImageRuntimeVariant,
  phase: LocalImageRuntimeInstallProgress['phase'],
  downloadedBytes: number,
  totalBytes: number,
  message: string,
): LocalImageRuntimeInstallProgress {
  return { variant: variant.id, phase, downloadedBytes, totalBytes, message };
}

function safeSegment(value: string): string {
  if (!/^[a-z0-9._-]+$/i.test(value)) throw new Error('运行时路径片段无效。');
  return value;
}

function assertContained(parent: string, target: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('运行时目标目录超出托管范围。');
}

function removeManagedTree(parent: string, target: string): void {
  if (!fs.existsSync(target)) return;
  assertContained(parent, target);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 2 });
}

function writeAll(handle: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(handle, bytes, offset, bytes.length - offset);
}

function verifiedExistingRuntime(
  installRoot: string,
  manifest: RuntimeManifest,
  variant: LocalImageRuntimeVariant,
): string {
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(installRoot, 'install-receipt.json'), 'utf8')) as Record<string, unknown>;
    if (receipt.schemaVersion !== 1 || receipt.variant !== variant.id || receipt.releaseTag !== manifest.releaseTag || receipt.archiveSha256 !== variant.sha256) return '';
    if (typeof receipt.runtimeRelativePath !== 'string' || typeof receipt.executableSha256 !== 'string') return '';
    const runtimePath = path.resolve(installRoot, receipt.runtimeRelativePath);
    assertContained(installRoot, runtimePath);
    const realInstallRoot = fs.realpathSync(installRoot);
    const realRuntimePath = fs.realpathSync(runtimePath);
    assertContained(realInstallRoot, realRuntimePath);
    if (!isRegularNonSymlink(realRuntimePath) || hashFile(realRuntimePath) !== receipt.executableSha256) return '';
    return realRuntimePath;
  } catch {
    return '';
  }
}

function writeInstallReceipt(
  installRoot: string,
  runtimePath: string,
  manifest: RuntimeManifest,
  variant: LocalImageRuntimeVariant,
): void {
  fs.writeFileSync(path.join(installRoot, 'install-receipt.json'), JSON.stringify({
    schemaVersion: 1,
    variant: variant.id,
    releaseTag: manifest.releaseTag,
    archiveSha256: variant.sha256,
    runtimeRelativePath: path.relative(installRoot, runtimePath),
    executableSha256: hashFile(runtimePath),
    installedAt: new Date().toISOString(),
  }, null, 2), { flag: 'wx' });
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(handle);
  }
}

function isRegularNonSymlink(filePath: string): boolean {
  const stat = fs.lstatSync(filePath);
  return stat.isFile() && !stat.isSymbolicLink();
}

function findExecutable(root: string, executable: string): string {
  if (!fs.existsSync(root)) return '';
  const queue = [path.resolve(root)];
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const directory = queue.shift();
    if (!directory) break;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) return candidate;
      if (entry.isDirectory() && path.relative(root, candidate).split(path.sep).length <= 4) queue.push(candidate);
    }
  }
  return '';
}

function extractZip(archivePath: string, destination: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-xf', archivePath, '-C', destination], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let diagnostics = '';
    child.stderr.on('data', chunk => { if (diagnostics.length < 8_000) diagnostics += String(chunk); });
    child.once('error', error => reject(new Error(`无法启动系统解压工具：${error.message}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`运行时解压失败（${code ?? 'unknown'}）：${diagnostics.trim().slice(0, 1_000)}`)));
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    child.once('close', () => signal.removeEventListener('abort', abort));
  });
}
