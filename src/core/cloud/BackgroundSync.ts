import { app, nativeImage, type NativeImage } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const BACKGROUND_RESOURCE_ID = 'preference.background';
const MAX_EDGE = 1600;
const MAX_JPEG_BYTES = 180 * 1024;

export interface CloudBackgroundPayload extends Record<string, unknown> {
  origin: 'desktop' | 'android';
  schemaVersion: 1;
  enabled: boolean;
  mimeType?: 'image/jpeg';
  width?: number;
  height?: number;
  sha256?: string;
  dataBase64?: string;
}

export function saveDesktopBackgroundFromFile(sourcePath: string): CloudBackgroundPayload {
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('所选文件不是可读取的图片。');
  const adapted = adaptImage(image);
  writeBackground(adapted.bytes);
  return payloadFor(adapted, 'desktop');
}

export function clearDesktopBackground(): void {
  const target = backgroundPath();
  try { fs.unlinkSync(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function desktopBackgroundPayload(): CloudBackgroundPayload {
  const target = backgroundPath();
  if (!fs.existsSync(target)) return { origin: 'desktop', schemaVersion: 1, enabled: false };
  const bytes = fs.readFileSync(target);
  if (bytes.length === 0 || bytes.length > MAX_JPEG_BYTES) throw new Error('本机背景适配副本无效。');
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width < 1 || size.height < 1) throw new Error('本机背景适配副本无法读取。');
  return payloadFor({ bytes, width: size.width, height: size.height }, 'desktop');
}

export function applyCloudBackground(payload: Record<string, unknown>): void {
  if (payload.schemaVersion !== 1 || typeof payload.enabled !== 'boolean') return;
  if (!payload.enabled) {
    clearDesktopBackground();
    return;
  }
  if (payload.mimeType !== 'image/jpeg' || typeof payload.dataBase64 !== 'string') return;
  const incoming = Buffer.from(payload.dataBase64, 'base64');
  if (incoming.length === 0 || incoming.length > MAX_JPEG_BYTES) return;
  if (typeof payload.sha256 === 'string' && sha256(incoming) !== payload.sha256) return;
  const image = nativeImage.createFromBuffer(incoming);
  if (image.isEmpty()) return;
  // Decode and encode again on receipt. The account copy cannot smuggle image
  // metadata or a format-specific payload into the local background cache.
  writeBackground(adaptImage(image).bytes);
}

export function desktopBackgroundDataUrl(): string | null {
  const target = backgroundPath();
  if (!fs.existsSync(target)) return null;
  const bytes = fs.readFileSync(target);
  return bytes.length > 0 && bytes.length <= MAX_JPEG_BYTES
    ? `data:image/jpeg;base64,${bytes.toString('base64')}`
    : null;
}

function adaptImage(source: NativeImage): { bytes: Buffer; width: number; height: number } {
  const original = source.getSize();
  if (original.width < 1 || original.height < 1) throw new Error('图片尺寸无效。');
  let scale = Math.min(1, MAX_EDGE / Math.max(original.width, original.height));
  let width = Math.max(1, Math.round(original.width * scale));
  let height = Math.max(1, Math.round(original.height * scale));
  let image = source.resize({ width, height, quality: 'good' });
  for (const quality of [82, 74, 66, 58, 50, 42]) {
    const bytes = image.toJPEG(quality);
    if (bytes.length <= MAX_JPEG_BYTES) return { bytes, width, height };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    width = Math.max(1, Math.round(width * 0.82));
    height = Math.max(1, Math.round(height * 0.82));
    image = source.resize({ width, height, quality: 'good' });
    const bytes = image.toJPEG(58);
    if (bytes.length <= MAX_JPEG_BYTES) return { bytes, width, height };
  }
  throw new Error('图片在安全压缩后仍超过同步上限。');
}

function payloadFor(
  adapted: { bytes: Buffer; width: number; height: number },
  origin: 'desktop' | 'android',
): CloudBackgroundPayload {
  return {
    origin,
    schemaVersion: 1,
    enabled: true,
    mimeType: 'image/jpeg',
    width: adapted.width,
    height: adapted.height,
    sha256: sha256(adapted.bytes),
    dataBase64: adapted.bytes.toString('base64'),
  };
}

function writeBackground(bytes: Buffer): void {
  const target = backgroundPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { mode: 0o600 });
}

function backgroundPath(): string {
  return path.join(app.getPath('userData'), 'appearance', 'background-adapted.jpg');
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
