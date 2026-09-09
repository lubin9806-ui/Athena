import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getChatWindow, getDatabase, getDatabaseFilePath } from '../../memory';
import { detectAudioMime, detectChatDocumentMime } from '../documents/DocumentMime';
import type { ChatAttachment, ChatAttachmentKind, ChatAttachmentMimeType } from '../../shared/types';
import type { ModelImageInput } from '../ai/model';
import { detectImageMimeType } from '../ai/model/ModelImageLoader';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const MAX_ATTACHMENT_TEXT_CHARS = 140_000;
const MAX_IMAGE_EDGE = 16_384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const PENDING_RETENTION_MS = 24 * 60 * 60 * 1000;

interface AttachmentRow {
  id: string;
  window_id: number;
  message_id: number | null;
  project_id: number;
  kind: ChatAttachmentKind;
  mime_type: ChatAttachmentMimeType;
  original_name: string;
  storage_path: string;
  bytes: number;
  width: number | null;
  height: number | null;
  content_text: string | null;
  sha256: string;
  status: 'pending' | 'attached';
  created_at: string;
}

export interface PreparedChatAttachment {
  sourcePath: string;
  kind: ChatAttachmentKind;
  mimeType?: ChatAttachmentMimeType;
  contentText?: string;
  sourceSha256?: string;
}

export interface ChatAttachmentTextContext {
  id: string;
  name: string;
  kind: 'document' | 'audio';
  mimeType: ChatAttachmentMimeType;
  text: string;
}

export class AttachmentService {
  readonly root: string;

  constructor(root = resolveAttachmentRoot()) {
    this.root = path.resolve(root);
    this.ensureManagedRoot();
  }

  async importImages(windowId: number, sourcePaths: string[]): Promise<ChatAttachment[]> {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('Attachment chat window is not available');
    const uniquePaths = Array.from(new Set(sourcePaths.map(source => path.resolve(source))));
    if (uniquePaths.length === 0) return [];
    if (uniquePaths.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`一条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);

    const imported: AttachmentRow[] = [];
    try {
      for (const sourcePath of uniquePaths) imported.push(await this.importImage(chatWindow.id, chatWindow.project_id, sourcePath));
      return await this.toPublicList(imported);
    } catch (error) {
      for (const row of imported) this.deleteRowAndFile(row);
      throw error;
    }
  }

  async createGeneratedImage(windowId: number, messageId: number, source: Buffer, originalName: string): Promise<ChatAttachment> {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('Generated-image chat window is not available');
    const message = getDatabase().prepare('SELECT id FROM chat_messages WHERE id = ? AND window_id = ?').get(messageId, windowId);
    if (!message) throw new Error('Generated-image target message does not belong to the active chat window');
    const inspected = await inspectAttachmentImage(source);
    const bytes = inspected.bytes;
    const id = crypto.randomUUID();
    const targetDir = path.join(this.root, `window-${windowId}`);
    fs.mkdirSync(targetDir, { recursive: true });
    this.requireManagedDirectory(targetDir);
    const targetPath = path.join(targetDir, `${id}.${extensionFor(inspected.mimeType)}`);
    fs.writeFileSync(targetPath, bytes, { flag: 'wx' });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    try {
      getDatabase().prepare(`
        INSERT INTO chat_attachments (
          id, window_id, message_id, project_id, kind, mime_type, original_name, storage_path,
          bytes, width, height, sha256, status
        ) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, 'attached')
      `).run(
        id, windowId, messageId, chatWindow.project_id, inspected.mimeType,
        cleanOriginalName(originalName), targetPath, bytes.length,
        inspected.width, inspected.height, sha256,
      );
    } catch (error) {
      this.removeManagedFile(targetPath, true);
      throw error;
    }
    const row = this.getOwnedRow(windowId, id);
    if (!row) throw new Error('Generated image attachment was not persisted');
    return this.toPublicWithPreview(row);
  }

  async importPreparedFiles(windowId: number, inputs: PreparedChatAttachment[]): Promise<ChatAttachment[]> {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('当前聊天不可添加附件。');
    const unique = Array.from(new Map(inputs.map(input => [path.resolve(input.sourcePath), { ...input, sourcePath: path.resolve(input.sourcePath) }])).values());
    if (unique.length === 0) return [];
    if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`一条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);

    const imported: AttachmentRow[] = [];
    try {
      for (const input of unique) {
        imported.push(input.kind === 'image'
          ? await this.importImage(chatWindow.id, chatWindow.project_id, input.sourcePath)
          : this.importTextBackedFile(chatWindow.id, chatWindow.project_id, input));
      }
      return await this.toPublicList(imported);
    } catch (error) {
      for (const row of imported) this.deleteRowAndFile(row);
      throw error;
    }
  }

  resolveModelImages(windowId: number, attachmentIds: string[]): ModelImageInput[] {
    const rows = this.requireOwnedRows(windowId, attachmentIds, ['pending', 'attached']);
    return rows.filter(row => row.kind === 'image').map(row => ({
      id: row.id,
      name: row.original_name,
      mimeType: row.mime_type as ModelImageInput['mimeType'],
      filePath: this.requireManagedPath(row.storage_path),
      sha256: row.sha256,
      bytes: row.bytes,
      detail: 'auto',
    }));
  }

  resolveTextContext(windowId: number, attachmentIds: string[]): ChatAttachmentTextContext[] {
    const rows = this.requireOwnedRows(windowId, attachmentIds, ['pending', 'attached']);
    return rows
      .filter((row): row is AttachmentRow & { kind: 'document' | 'audio'; content_text: string } => (
        row.kind !== 'image' && Boolean(row.content_text?.trim())
      ))
      .map(row => ({
        id: row.id,
        name: row.original_name,
        kind: row.kind,
        mimeType: row.mime_type,
        text: row.content_text,
      }));
  }

  attachToMessage(windowId: number, messageId: number, attachmentIds: string[]): ChatAttachment[] {
    const rows = this.requireOwnedRows(windowId, attachmentIds, ['pending']);
    if (rows.length === 0) return [];
    const db = getDatabase();
    const message = db.prepare('SELECT id FROM chat_messages WHERE id = ? AND window_id = ?').get(messageId, windowId);
    if (!message) throw new Error('Attachment target message does not belong to the active chat window');
    const placeholders = rows.map(() => '?').join(', ');
    const result = db.prepare(`
      UPDATE chat_attachments
      SET message_id = ?, status = 'attached'
      WHERE window_id = ? AND status = 'pending' AND id IN (${placeholders})
    `).run(messageId, windowId, ...rows.map(row => row.id));
    if (result.changes !== rows.length) throw new Error('Attachment binding changed concurrently; no partial binding is accepted');
    return this.listForMessage(messageId);
  }

  listForMessage(messageId: number): ChatAttachment[] {
    const rows = getDatabase().prepare(`
      SELECT ${attachmentFields()}
      FROM chat_attachments
      WHERE message_id = ? AND status = 'attached'
      ORDER BY created_at ASC, rowid ASC
    `).all(messageId) as AttachmentRow[];
    return rows.map(row => this.toPublic(row));
  }

  async getPreview(windowId: number, attachmentId: string): Promise<string | null> {
    const row = this.getOwnedRow(windowId, cleanAttachmentId(attachmentId));
    if (!row || row.kind !== 'image') return null;
    const bytes = fs.readFileSync(this.requireManagedPath(row.storage_path));
    if (bytes.length !== row.bytes || detectImageMimeType(bytes) !== row.mime_type
      || crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
    let image: Awaited<ReturnType<typeof loadImage>>;
    try {
      image = await loadImage(bytes);
    } catch {
      return null;
    }
    if (!(image.width > 0) || !(image.height > 0)) return null;
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
  }

  removePending(windowId: number, attachmentId: string): boolean {
    const row = this.getOwnedRow(windowId, cleanAttachmentId(attachmentId));
    if (!row || row.status !== 'pending') return false;
    this.deleteRowAndFile(row);
    return true;
  }

  cleanupStalePending(now = new Date()): number {
    const cutoff = toSqliteLocalDateTime(new Date(now.getTime() - PENDING_RETENTION_MS));
    const rows = getDatabase().prepare(`
      SELECT ${attachmentFields()}
      FROM chat_attachments
      WHERE status = 'pending' AND created_at < ?
    `).all(cutoff) as AttachmentRow[];
    for (const row of rows) this.deleteRowAndFile(row);
    return rows.length;
  }

  cleanupTemporaryWindowFiles(): number {
    const rows = getDatabase().prepare(`
      SELECT ${attachmentFields('ca')}
      FROM chat_attachments ca
      JOIN chat_windows cw ON cw.id = ca.window_id
      WHERE cw.is_temporary = 1
    `).all() as AttachmentRow[];
    for (const row of rows) this.deleteRowAndFile(row);
    return rows.length;
  }

  // Attachment rows cascade away with their chat_messages row, which would leave
  // the managed files behind. Must run before purgeEphemeralChatMessages, while
  // the rows that name those files still exist (ATH-DATA-002).
  cleanupEphemeralMessageFiles(): number {
    const rows = getDatabase().prepare(`
      SELECT ${attachmentFields('ca')}
      FROM chat_attachments ca
      JOIN chat_messages cm ON cm.id = ca.message_id
      WHERE cm.ephemeral = 1
    `).all() as AttachmentRow[];
    for (const row of rows) this.deleteRowAndFile(row);
    return rows.length;
  }

  // Same ordering rule as the ephemeral sweep: the rows naming these files cascade
  // away with their messages, so the files go first (ATH-DATA-003).
  cleanupExpiredMessageFiles(cutoffIso: string): number {
    const rows = getDatabase().prepare(`
      SELECT ${attachmentFields('ca')}
      FROM chat_attachments ca
      JOIN chat_messages cm ON cm.id = ca.message_id
      WHERE cm.created_at < ?
    `).all(cutoffIso) as AttachmentRow[];
    for (const row of rows) this.deleteRowAndFile(row);
    return rows.length;
  }

  cleanupWindowFiles(windowId: number): number {
    const rows = getDatabase().prepare(`SELECT ${attachmentFields()} FROM chat_attachments WHERE window_id = ?`).all(windowId) as AttachmentRow[];
    for (const row of rows) this.deleteRowAndFile(row);
    return rows.length;
  }

  clearAllFiles(): number {
    const rows = getDatabase().prepare(`SELECT ${attachmentFields()} FROM chat_attachments`).all() as AttachmentRow[];
    let deleted = 0;
    for (const row of rows) {
      if (this.removeManagedFile(row.storage_path, true)) deleted += 1;
    }
    return deleted;
  }

  private async importImage(windowId: number, projectId: number, sourcePath: string): Promise<AttachmentRow> {
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Attachment source must be a regular file');
    if (sourceStat.size <= 0 || sourceStat.size > MAX_IMAGE_BYTES) throw new Error('Image attachments must be between 1 byte and 10 MB');
    const inspected = await inspectAttachmentImage(fs.readFileSync(sourcePath));
    const mimeType = inspected.mimeType;
    // GIF and BMP are stored as the PNG they were converted into, so every byte
    // count, hash and preview below describes the file that is actually on disk.
    const bytes = inspected.bytes;

    const id = crypto.randomUUID();
    const extension = extensionFor(mimeType);
    const targetDir = path.join(this.root, `window-${windowId}`);
    fs.mkdirSync(targetDir, { recursive: true });
    this.requireManagedDirectory(targetDir);
    const targetPath = path.join(targetDir, `${id}.${extension}`);
    fs.writeFileSync(targetPath, bytes, { flag: 'wx' });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const originalName = cleanOriginalName(path.basename(sourcePath));
    try {
      getDatabase().prepare(`
        INSERT INTO chat_attachments (
          id, window_id, project_id, kind, mime_type, original_name, storage_path,
          bytes, width, height, sha256, status
        ) VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(id, windowId, projectId, mimeType, originalName, targetPath, bytes.length, inspected.width, inspected.height, sha256);
    } catch (error) {
      this.removeManagedFile(targetPath, true);
      throw error;
    }
    return this.getOwnedRow(windowId, id) as AttachmentRow;
  }

  private importTextBackedFile(windowId: number, projectId: number, input: PreparedChatAttachment): AttachmentRow {
    if (input.kind === 'image') throw new Error('图片附件必须经过图片验证。');
    const sourceStat = fs.lstatSync(input.sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('附件必须是普通文件。');
    if (sourceStat.size <= 0 || sourceStat.size > MAX_FILE_BYTES) throw new Error('文档或音频附件必须在 1 字节到 25 MB 之间。');
    const bytes = fs.readFileSync(input.sourcePath);
    if (bytes.length !== sourceStat.size) throw new Error('附件在读取过程中发生了变化。');
    const mimeType = detectNonImageMimeType(input.sourcePath, bytes);
    if (input.mimeType && mimeType !== input.mimeType) throw new Error('附件格式与解析结果不一致。');
    if ((input.kind === 'audio') !== mimeType.startsWith('audio/')) throw new Error('附件类型与文件格式不一致。');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (input.sourceSha256 && sha256 !== input.sourceSha256) throw new Error('附件在解析过程中发生了变化，请重新添加。');
    const contentText = input.contentText?.trim() || '';
    if (!contentText) throw new Error(input.kind === 'audio' ? '音频中没有识别到可用文字。' : '文档中没有可读取的文字。');
    if (contentText.length > MAX_ATTACHMENT_TEXT_CHARS) throw new Error('附件提取的文字超过聊天安全上限。');

    const id = crypto.randomUUID();
    const targetDir = path.join(this.root, `window-${windowId}`);
    fs.mkdirSync(targetDir, { recursive: true });
    this.requireManagedDirectory(targetDir);
    const targetPath = path.join(targetDir, `${id}.${extensionFor(mimeType)}`);
    fs.writeFileSync(targetPath, bytes, { flag: 'wx' });
    const originalName = cleanOriginalName(path.basename(input.sourcePath));
    try {
      getDatabase().prepare(`
        INSERT INTO chat_attachments (
          id, window_id, project_id, kind, mime_type, original_name, storage_path,
          bytes, width, height, content_text, sha256, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'pending')
      `).run(id, windowId, projectId, input.kind, mimeType, originalName, targetPath, bytes.length, contentText, sha256);
    } catch (error) {
      this.removeManagedFile(targetPath, true);
      throw error;
    }
    return this.getOwnedRow(windowId, id) as AttachmentRow;
  }

  private requireOwnedRows(
    windowId: number,
    attachmentIds: string[],
    allowedStatuses: AttachmentRow['status'][] = ['pending'],
  ): AttachmentRow[] {
    const ids = Array.from(new Set(attachmentIds.map(cleanAttachmentId).filter(Boolean)));
    if (ids.length !== attachmentIds.length || ids.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('Invalid attachment selection');
    const rows = ids.map(id => this.getOwnedRow(windowId, id)).filter((row): row is AttachmentRow => Boolean(row));
    if (rows.length !== ids.length || rows.some(row => !allowedStatuses.includes(row.status))) {
      throw new Error('One or more attachments are unavailable or belong to another chat window');
    }
    for (const row of rows) this.requireManagedPath(row.storage_path);
    return rows;
  }

  private getOwnedRow(windowId: number, id: string): AttachmentRow | null {
    if (!id) return null;
    const row = getDatabase().prepare(`
      SELECT ${attachmentFields()}
      FROM chat_attachments
      WHERE id = ? AND window_id = ?
      LIMIT 1
    `).get(id, windowId) as AttachmentRow | undefined;
    return row || null;
  }

  private toPublic(row: AttachmentRow): ChatAttachment {
    return {
      id: row.id,
      window_id: row.window_id,
      message_id: row.message_id ?? undefined,
      kind: row.kind,
      mime_type: row.mime_type,
      original_name: row.original_name,
      bytes: row.bytes,
      ...(row.width ? { width: row.width } : {}),
      ...(row.height ? { height: row.height } : {}),
      sha256: row.sha256,
      status: row.status,
      created_at: row.created_at,
    };
  }

  /** Decoding a thumbnail is asynchronous, so only the paths that need one pay for it. */
  private async toPublicWithPreview(row: AttachmentRow): Promise<ChatAttachment> {
    const preview = await this.getPreview(row.window_id, row.id);
    return { ...this.toPublic(row), ...(preview ? { preview_data_url: preview } : {}) };
  }

  private async toPublicList(rows: AttachmentRow[]): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];
    for (const row of rows) attachments.push(await this.toPublicWithPreview(row));
    return attachments;
  }

  private deleteRowAndFile(row: AttachmentRow): void {
    this.removeManagedFile(row.storage_path, true);
    getDatabase().prepare('DELETE FROM chat_attachments WHERE id = ?').run(row.id);
  }

  private removeManagedFile(filePath: string, strict = false): boolean {
    try {
      const managed = this.requireManagedPath(filePath, false);
      if (!fs.existsSync(managed)) return false;
      fs.rmSync(managed, { force: true });
      return true;
    } catch (error) {
      if (strict) throw error;
      return false;
    }
  }

  private requireManagedPath(filePath: string, mustExist = true): string {
    const realRoot = this.ensureManagedRoot();
    const resolved = path.resolve(filePath);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Attachment path is outside managed storage');
    if (mustExist) {
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Attachment storage path is not a regular file');
      const realFile = fs.realpathSync.native(resolved);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        throw new Error('Attachment storage path escapes through a symbolic link');
      }
    } else {
      this.requireManagedDirectory(path.dirname(resolved));
    }
    return resolved;
  }

  private ensureManagedRoot(): string {
    fs.mkdirSync(this.root, { recursive: true });
    const stat = fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Attachment storage root must be a real directory');
    return fs.realpathSync.native(this.root);
  }

  private requireManagedDirectory(directory: string): string {
    const realRoot = this.ensureManagedRoot();
    const resolved = path.resolve(directory);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Attachment directory is outside managed storage');
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Attachment directory must be a real directory');
    const realDirectory = fs.realpathSync.native(resolved);
    const realRelative = path.relative(realRoot, realDirectory);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Attachment directory escapes managed storage');
    return realDirectory;
  }
}

export function resolveAttachmentRoot(): string {
  return path.resolve(process.env.ATHENA_ATTACHMENT_DIR || path.join(path.dirname(getDatabaseFilePath()), 'attachments'));
}

function attachmentFields(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    'id', 'window_id', 'message_id', 'project_id', 'kind', 'mime_type', 'original_name',
    'storage_path', 'bytes', 'width', 'height', 'content_text', 'sha256', 'status', 'created_at',
  ].map(field => `${prefix}${field} AS ${field}`).join(', ');
}

function cleanAttachmentId(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : '';
}

function cleanOriginalName(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  return (cleaned || 'attachment').slice(0, 180);
}

interface InspectedAttachmentImage {
  mimeType: ChatAttachmentMimeType;
  width: number;
  height: number;
  /** What actually gets stored — re-encoded when the source format is not one the rest of the pipeline reads. */
  bytes: Buffer;
}

/**
 * Decodes with the canvas backend rather than Electron's nativeImage, which only
 * understands PNG and JPEG — every WebP attachment used to fail its decode check
 * even though WebP was advertised as supported.
 *
 * GIF and BMP decode here too, and are re-encoded to PNG on the way in: the
 * stored copy stays in a format the model path and the preview path both read,
 * while original_name keeps the name the person dragged in.
 */
async function inspectAttachmentImage(bytes: Buffer): Promise<InspectedAttachmentImage> {
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image attachments must be between 1 byte and 10 MB');
  // loadImage rather than assigning to Image.src: that setter only looks
  // synchronous. A BMP decoded through it reports 0x0 until the event loop
  // turns, so the sync path silently rejects valid files depending on timing.
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(bytes);
  } catch {
    throw new Error('这张图片无法解码，仅支持 PNG、JPG、WebP、GIF 和 BMP。');
  }
  const width = image.width;
  const height = image.height;
  if (!(width > 0) || !(height > 0)) throw new Error('这张图片无法解码，仅支持 PNG、JPG、WebP、GIF 和 BMP。');
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('The selected image dimensions exceed the safe attachment limit');
  }

  const storable = detectImageMimeType(bytes);
  if (storable) return { mimeType: storable, width, height, bytes };

  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const converted = canvas.toBuffer('image/png');
  if (converted.length <= 0 || converted.length > MAX_IMAGE_BYTES) throw new Error('这张图片转换后超过了 10 MB 的附件上限。');
  return { mimeType: 'image/png', width, height, bytes: converted };
}

function extensionFor(mimeType: ChatAttachmentMimeType): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'text/plain') return 'txt';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('wordprocessingml.document')) return 'docx';
  if (mimeType.includes('spreadsheetml.sheet')) return 'xlsx';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/aiff') return 'aiff';
  return 'flac';
}

function detectNonImageMimeType(filePath: string, bytes: Buffer): ChatAttachmentMimeType {
  return detectAudioMime(filePath, bytes) ?? detectChatDocumentMime(filePath, bytes);
}

function toSqliteLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
