import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorker, OEM, type Worker } from 'tesseract.js';

export interface LocalOcrImage {
  bytes: Buffer;
  label: string;
}

export interface LocalOcrResult {
  label: string;
  text: string;
  confidence: number;
}

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const MAX_RESULT_CHARS = 1_500_000;
const LANGUAGE_FILES = [
  { code: 'chi_sim', packageName: '@tesseract.js-data/chi_sim' },
  { code: 'eng', packageName: '@tesseract.js-data/eng' },
] as const;

export class LocalOcrService {
  private readonly runtimeRoot: string;
  private active = false;
  private closed = false;
  private currentWorker: Worker | null = null;
  private activeCompletion: Promise<void> | null = null;
  private finishActive: (() => void) | null = null;
  private readonly shutdownController = new AbortController();

  constructor(runtimeRoot = path.join(os.tmpdir(), 'athena-ocr-runtime', String(process.pid))) {
    this.runtimeRoot = path.resolve(runtimeRoot);
  }

  async recognize(images: LocalOcrImage[], signal?: AbortSignal): Promise<LocalOcrResult[]> {
    if (this.closed) throw new Error('Local OCR service is shut down.');
    if (this.active) throw new Error('Local OCR is already processing another batch.');
    if (images.length === 0 || images.length > MAX_IMAGES) throw new Error(`Local OCR accepts 1-${MAX_IMAGES} images per batch.`);
    let totalBytes = 0;
    for (const image of images) {
      if (!image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES) throw new Error('OCR image exceeds the 15 MB limit.');
      totalBytes += image.bytes.length;
    }
    if (totalBytes > MAX_BATCH_BYTES) throw new Error('OCR image batch exceeds the 80 MB limit.');
    if (signal?.aborted) throw abortError(signal);

    this.active = true;
    this.activeCompletion = new Promise(resolve => { this.finishActive = resolve; });
    let worker: Worker | null = null;
    const abort = () => {
      void worker?.terminate().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.shutdownController.signal.addEventListener('abort', abort, { once: true });
    try {
      const langPath = this.prepareLanguageData();
      worker = await createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
        langPath,
        gzip: true,
        cacheMethod: 'readOnly',
      });
      this.currentWorker = worker;
      this.throwIfAborted(signal);
      const results: LocalOcrResult[] = [];
      let resultChars = 0;
      for (const image of images) {
        this.throwIfAborted(signal);
        const output = await worker.recognize(image.bytes);
        const text = normalizeText(output.data.text);
        resultChars += text.length;
        if (resultChars > MAX_RESULT_CHARS) throw new Error('OCR text exceeds the safe extraction limit.');
        results.push({
          label: cleanLabel(image.label),
          text,
          confidence: clampConfidence(output.data.confidence),
        });
      }
      return results;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (this.shutdownController.signal.aborted) throw abortError(this.shutdownController.signal);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.shutdownController.signal.removeEventListener('abort', abort);
      if (worker) await worker.terminate().catch(() => undefined);
      this.currentWorker = null;
      this.active = false;
      this.finishActive?.();
      this.finishActive = null;
      this.activeCompletion = null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.shutdownController.abort(new Error('Local OCR service is shutting down.'));
    await this.currentWorker?.terminate().catch(() => undefined);
    await this.activeCompletion;
    fs.rmSync(this.runtimeRoot, { recursive: true, force: true });
  }

  private prepareLanguageData(): string {
    fs.mkdirSync(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const rootStat = fs.lstatSync(this.runtimeRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('OCR runtime root must be a real directory.');
    const realRoot = fs.realpathSync.native(this.runtimeRoot);
    if (realRoot !== this.runtimeRoot) throw new Error('OCR runtime root changed during validation.');
    for (const item of LANGUAGE_FILES) {
      const packageData = require(item.packageName) as { code?: string; gzip?: boolean; langPath?: string };
      if (packageData.code !== item.code || packageData.gzip !== true || typeof packageData.langPath !== 'string') {
        throw new Error(`Bundled OCR language package is invalid: ${item.code}`);
      }
      const source = path.join(packageData.langPath, `${item.code}.traineddata.gz`);
      const target = path.join(this.runtimeRoot, `${item.code}.traineddata.gz`);
      copyVerifiedLanguageFile(source, target, realRoot);
    }
    return this.runtimeRoot;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError(signal);
    if (this.shutdownController.signal.aborted) throw abortError(this.shutdownController.signal);
  }
}

function copyVerifiedLanguageFile(source: string, target: string, realRoot: string): void {
  if (path.dirname(path.resolve(target)) !== realRoot) throw new Error('OCR language target escaped the runtime directory.');
  const bytes = fs.readFileSync(source);
  if (bytes.length < 1_024 || bytes.length > 32 * 1024 * 1024 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('Bundled OCR language data failed validation.');
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error('OCR language target must be a regular file.');
    const existing = fs.readFileSync(target);
    if (existing.length === bytes.length && crypto.createHash('sha256').update(existing).digest('hex') === digest) return;
    fs.rmSync(target, { force: true });
  }
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanLabel(value: string): string {
  return (String(value || 'image').replace(/[\u0000-\u001f]/g, ' ').trim() || 'image').slice(0, 180);
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value * 10) / 10)) : 0;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Local OCR was cancelled.');
}
