import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ModelImageInput, ModelImageMimeType } from './ModelTypes';
import { ModelProtocolError } from './ModelTypes';

const MAX_MODEL_IMAGE_BYTES = 10 * 1024 * 1024;

export function loadModelImageBase64(image: ModelImageInput): string {
  if (!path.isAbsolute(image.filePath)) throw new ModelProtocolError('Model image path must be absolute');
  const stat = fs.lstatSync(image.filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ModelProtocolError('Model image must be a regular managed file');
  if (stat.size !== image.bytes || stat.size <= 0 || stat.size > MAX_MODEL_IMAGE_BYTES) {
    throw new ModelProtocolError('Model image size no longer matches its validated attachment record');
  }
  const bytes = fs.readFileSync(image.filePath);
  if (detectImageMimeType(bytes) !== image.mimeType) throw new ModelProtocolError('Model image format no longer matches its validated attachment record');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!timingSafeHexEqual(digest, image.sha256)) throw new ModelProtocolError('Model image integrity check failed');
  return bytes.toString('base64');
}

export function detectImageMimeType(bytes: Buffer): ModelImageMimeType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
