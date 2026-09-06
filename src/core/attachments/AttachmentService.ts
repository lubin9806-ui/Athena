import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nativeImage } from 'electron';
import { getChatWindow, getDatabase, getDatabaseFilePath } from '../../memory';
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

  importImages(windowId: number, sourcePaths: string[]): ChatAttachment[] {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('Attachment chat window is not available');
    const uniquePaths = Array.from(new Set(sourcePaths.map(source => path.resolve(source))));
    if (uniquePaths.length === 0) return [];
    if (uniquePaths.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`一条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);

    const imported: AttachmentRow[] = [];
    try {
      for (const sourcePath of uniquePaths) imported.push(this.importImage(chatWindow.id, chatWindow.project_id, sourcePath));
      return imported.map(row => this.toPublic(row, true));
    } catch (error) {
      for (const row of imported) this.deleteRowAndFile(row);
      throw error;
    }
  }

  createGeneratedImage(windowId: number, messageId: number, bytes: Buffer, originalName: string): ChatAttachment {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('Generated-image chat window is not available');
    const message = getDatabase().prepare('SELECT id FROM chat_messages WHERE id = ? AND window_id = ?').get(messageId, windowId);
    if (!message) throw new Error('Generated-image target message does not belong to the active chat window');
    const inspected = inspectAttachmentImage(bytes);
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
    return this.toPublic(row, true);
  }

  importPreparedFiles(windowId: number, inputs: PreparedChatAttachment[]): ChatAttachment[] {
    const chatWindow = getChatWindow(windowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('当前聊天不可添加附件。');
    const unique = Array.from(new Map(inputs.map(input => [path.resolve(input.sourcePath), { ...input, sourcePath: path.resolve(input.sourcePath) }])).values());
    if (unique.length === 0) return [];
    if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`一条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);

    const imported: AttachmentRow[] = [];
    try {
      for (const input of unique) {
        imported.push(input.kind === 'image'
          ? this.importImage(chatWindow.id, chatWindow.project_id, input.sourcePath)
          : this.importTextBackedFile(chatWindow.id, chatWindow.project_id, input));
      }
      return imported.map(row => this.toPublic(row, true));
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
    return rows.map(row => this.toPublic(row, false));
  }

  getPreview(windowId: number, attachmentId: string): string | null {
    const row = this.getOwnedRow(windowId, cleanAttachmentId(attachmentId));
    if (!row || row.kind !== 'image') return null;
    const bytes = fs.readFileSync(this.requireManagedPath(row.storage_path));
    if (bytes.length !== row.bytes || detectImageMimeType(bytes) !== row.mime_type
      || crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const scale = Math.min(1, 640 / Math.max(size.width, size.height));
    const preview = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), quality: 'good' })
      : image;
    return `data:image/png;base64,${preview.toPNG().toString('base64')}`;
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

  private importImage(windowId: number, projectId: number, sourcePath: string): AttachmentRow {
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Attachment source must be a regular file');
    if (sourceStat.size <= 0 || sourceStat.size > MAX_IMAGE_BYTES) throw new Error('Image attachments must be between 1 byte and 10 MB');
    const bytes = fs.readFileSync(sourcePath);
    const inspected = inspectAttachmentImage(bytes);
    const mimeType = inspected.mimeType;

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

  private toPublic(row: AttachmentRow, includePreview: boolean): ChatAttachment {
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
      ...(includePreview ? { preview_data_url: this.getPreview(row.window_id, row.id) || undefined } : {}),
    };
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

function inspectAttachmentImage(bytes: Buffer): { mimeType: ChatAttachmentMimeType; width: number; height: number } {
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image attachments must be between 1 byte and 10 MB');
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) throw new Error('Only PNG, JPEG, and WebP image attachments are supported');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('The selected image could not be decoded');
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0 || size.width > MAX_IMAGE_EDGE || size.height > MAX_IMAGE_EDGE || size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new Error('The selected image dimensions exceed the safe attachment limit');
  }
  return { mimeType, width: size.width, height: size.height };
}

function extensionFor(mimeType: ChatAttachmentMimeType): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'text/plain') return 'txt';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('wordprocessingml.document')) return 'docx';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/aiff') return 'aiff';
  return 'flac';
}

function detectNonImageMimeType(filePath: string, bytes: Buffer): ChatAttachmentMimeType {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (extension === '.docx' && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    if (bytes.includes(0)) throw new Error('文本附件看起来是二进制文件。');
    return extension === '.txt' ? 'text/plain' : 'text/markdown';
  }
  if (extension === '.wav' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if ((extension === '.aiff' || extension === '.aif') && bytes.subarray(0, 4).toString('ascii') === 'FORM'
    && ['AIFF', 'AIFC'].includes(bytes.subarray(8, 12).toString('ascii'))) return 'audio/aiff';
  if (extension === '.flac' && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  throw new Error('仅支持 PNG、JPG、WebP、TXT、Markdown、PDF、DOCX、WAV、AIFF 和 FLAC。');
}

function toSqliteLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
