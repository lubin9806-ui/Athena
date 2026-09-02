import { createHash } from 'crypto';
import type { ImageProviderId } from '../../shared/types';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x2048' | '2048x1152' | 'auto';

export interface ImageGenerationRequest {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: ImageOutputFormat;
  outputCompression?: number;
}

export interface ImageEditInput {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  name: string;
  sha256: string;
}

export interface ImageEditRequest extends ImageGenerationRequest {
  images: ImageEditInput[];
  mask?: ImageEditInput;
}

export interface GeneratedImage {
  bytes: Buffer;
  format: ImageOutputFormat;
  width: number;
  height: number;
  provider: ImageProviderId;
  model: string;
  requestId: string | null;
  usage?: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage>;
  edit?(request: ImageEditRequest, signal: AbortSignal): Promise<GeneratedImage>;
  supportsEditing?(): boolean;
}

export interface OpenAIImageGenerationProviderOptions {
  credentialResolver: () => string | null;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
  fetcher?: typeof fetch;
  model?: string;
}

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  private readonly fetcher: typeof fetch;
  private readonly model: string;

  constructor(private readonly options: OpenAIImageGenerationProviderOptions) {
    this.fetcher = options.fetcher || fetch;
    this.model = normalizeModel(options.model || process.env.ATHENA_IMAGE_MODEL || 'gpt-image-2');
  }

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const apiKey = this.options.credentialResolver();
    if (!apiKey) throw new Error('OpenAI API credential is not configured');
    const prompt = requireText(request.prompt, 'Image prompt', 32_000);
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size: request.size,
        quality: request.quality,
        output_format: request.outputFormat,
        ...(request.outputFormat !== 'png' && request.outputCompression !== undefined
          ? { output_compression: clampInteger(request.outputCompression, 0, 100) }
          : {}),
      }),
    });
    if (response.status >= 300 && response.status < 400) throw new Error('OpenAI image endpoint returned an unexpected redirect');
    return this.readGeneratedImage(response, request.outputFormat, signal, 'generation');
  }

  async edit(request: ImageEditRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const apiKey = this.options.credentialResolver();
    if (!apiKey) throw new Error('OpenAI API credential is not configured');
    const prompt = requireText(request.prompt, 'Image edit prompt', 32_000);
    validateEditInputs(request.images, request.mask, this.options.decodeValidator);
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', prompt);
    form.set('size', request.size);
    form.set('quality', request.quality);
    form.set('output_format', request.outputFormat);
    if (request.outputFormat !== 'png' && request.outputCompression !== undefined) {
      form.set('output_compression', String(clampInteger(request.outputCompression, 0, 100)));
    }
    for (const image of request.images) {
      form.append('image[]', new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), safeUploadName(image.name, image.mimeType));
    }
    if (request.mask) {
      form.set('mask', new Blob([new Uint8Array(request.mask.bytes)], { type: request.mask.mimeType }), safeUploadName(request.mask.name, request.mask.mimeType));
    }
    const response = await this.fetcher(EDIT_ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (response.status >= 300 && response.status < 400) throw new Error('OpenAI image edit endpoint returned an unexpected redirect');
    return this.readGeneratedImage(response, request.outputFormat, signal, 'edit');
  }

  private async readGeneratedImage(
    response: Response,
    outputFormat: ImageOutputFormat,
    signal: AbortSignal,
    operation: 'generation' | 'edit',
  ): Promise<GeneratedImage> {
    const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES, signal);
    const payload = parseJsonObject(raw);
    if (!response.ok) throw new Error(`OpenAI image ${operation} failed (${response.status}): ${extractApiError(payload)}`);
    const encoded = imageBase64(payload);
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('OpenAI returned an empty or oversized image');
    const detected = inspectImage(bytes);
    const decoded = this.options.decodeValidator(bytes);
    if (decoded.width !== detected.width || decoded.height !== detected.height) throw new Error('Decoded image dimensions do not match the file header');
    if (detected.format !== outputFormat) throw new Error(`OpenAI returned ${detected.format} while ${outputFormat} was requested`);
    return {
      bytes, format: detected.format, width: detected.width, height: detected.height,
      provider: 'openai', model: this.model, requestId: response.headers.get('x-request-id'),
      ...(isRecord(payload.usage) ? { usage: sanitizeUsage(payload.usage) } : {}),
    };
  }
}

function validateEditInputs(
  images: ImageEditInput[],
  mask: ImageEditInput | undefined,
  decodeValidator: (bytes: Buffer) => { width: number; height: number },
): void {
  if (images.length === 0 || images.length > 5) throw new Error('Image editing requires 1-5 reference images');
  let total = 0;
  const inspected = images.map(image => {
    if (!image.bytes.length || image.bytes.length > 10 * 1024 * 1024) throw new Error('Reference image exceeds the 10 MB limit');
    total += image.bytes.length;
    if (cryptoHash(image.bytes) !== image.sha256) throw new Error('Reference image hash failed validation');
    const header = inspectImage(image.bytes);
    const decoded = decodeValidator(image.bytes);
    const detectedMimeType = `image/${header.format}` as ImageEditInput['mimeType'];
    if (detectedMimeType !== image.mimeType || decoded.width !== header.width || decoded.height !== header.height) {
      throw new Error('Reference image metadata failed validation');
    }
    return header;
  });
  if (mask) {
    if (!mask.bytes.length || mask.bytes.length > 10 * 1024 * 1024) throw new Error('Image edit mask exceeds the 10 MB limit');
    total += mask.bytes.length;
    if (cryptoHash(mask.bytes) !== mask.sha256) throw new Error('Image edit mask hash failed validation');
    const maskHeader = inspectImage(mask.bytes);
    if (mask.mimeType !== 'image/png' || maskHeader.format !== 'png' || !pngHasAlpha(mask.bytes)) throw new Error('Image edit mask must be a PNG with an alpha channel');
    const decodedMask = decodeValidator(mask.bytes);
    if (decodedMask.width !== maskHeader.width || decodedMask.height !== maskHeader.height) throw new Error('Image edit mask failed decode validation');
    if (inspected[0].format !== 'png' || inspected[0].width !== maskHeader.width || inspected[0].height !== maskHeader.height) {
      throw new Error('Image edit mask must match the first PNG reference image dimensions');
    }
  }
  if (total >= 50 * 1024 * 1024) throw new Error('Image edit inputs must total less than 50 MB');
}

function cryptoHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngHasAlpha(bytes: Buffer): boolean {
  return bytes.length >= 26 && (bytes[25] === 4 || bytes[25] === 6);
}

function safeUploadName(value: string, mimeType: ImageEditInput['mimeType']): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
  const stem = (pathBasename(value).replace(/\.[A-Za-z0-9]{1,8}$/u, '').replace(/[^A-Za-z0-9._-]/g, '-') || 'image').slice(0, 80);
  return `${stem}.${extension}`;
}

function pathBasename(value: string): string {
  return String(value || '').replace(/\\/g, '/').split('/').pop() || '';
}

export function inspectImage(bytes: Buffer): { format: ImageOutputFormat; width: number; height: number } {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return inspectPng(bytes);
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return inspectJpeg(bytes);
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Generated WebP container length is invalid');
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return validDimensions('webp', 1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
    if (chunk === 'VP8 ' && bytes.length >= 30) return validDimensions('webp', bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return validDimensions('webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
  }
  throw new Error('Generated image has an unsupported or invalid file signature');
}

function inspectPng(bytes: Buffer): { format: ImageOutputFormat; width: number; height: number } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > MAX_IMAGE_BYTES || end > bytes.length) throw new Error('Generated PNG chunk length is invalid');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new Error(`Generated PNG ${type} chunk failed CRC validation`);
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Generated PNG does not start with a valid IHDR chunk');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      sawHeader = true;
    } else if (type === 'IHDR') {
      throw new Error('Generated PNG contains multiple IHDR chunks');
    }
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) throw new Error('Generated PNG has an invalid IEND chunk');
      sawEnd = true;
      break;
    }
    offset = end;
  }
  if (!sawHeader || !sawData || !sawEnd) throw new Error('Generated PNG is missing required chunks');
  return validDimensions('png', width, height);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectJpeg(bytes: Buffer): { format: ImageOutputFormat; width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return validDimensions('jpeg', bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  throw new Error('Generated JPEG has no valid dimensions');
}

function validDimensions(format: ImageOutputFormat, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) {
    throw new Error('Generated image dimensions are invalid');
  }
  return { format, width, height };
}

async function readBoundedBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Image generation was cancelled');
      const item = await reader.read();
      if (item.done) break;
      total += item.value.length;
      if (total > limit) throw new Error('OpenAI image response exceeded the allowed size');
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('expected object');
    return parsed;
  } catch (error) {
    throw new Error(`OpenAI image response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function imageBase64(payload: Record<string, unknown>): string {
  const first = Array.isArray(payload.data) ? payload.data[0] : null;
  const encoded = isRecord(first) && typeof first.b64_json === 'string' ? first.b64_json : '';
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) throw new Error('OpenAI image response did not contain bounded base64 image data');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('OpenAI image response contained invalid base64 data');
  return encoded;
}

function extractApiError(payload: Record<string, unknown>): string {
  const error = isRecord(payload.error) ? payload.error : {};
  return typeof error.message === 'string' ? error.message.slice(0, 1_000) : 'Unknown API error';
}

function sanitizeUsage(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => (
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null
  )).slice(0, 30));
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (!/^gpt-image-[A-Za-z0-9._-]+$/.test(model)) throw new Error('ATHENA_IMAGE_MODEL must name a GPT Image model');
  return model;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return text;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
