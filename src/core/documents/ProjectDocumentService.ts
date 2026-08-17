import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import {
  deleteProjectDocumentRecord,
  getDatabase,
  getDatabaseFilePath,
  getProject,
  getProjectDocument,
  getProjectDocumentStorageRecord,
  listProjectDocuments,
  saveProjectDocument,
  type ProjectDocumentChunkInput,
} from '../../memory';
import type { ProjectDocument } from '../../shared/types';

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 5_000;
const MAX_DOCX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 200;
const MAX_DOCUMENTS_PER_IMPORT = 5;
const MAX_PDF_PAGES = 300;
const MAX_EXTRACTED_CHARS = 1_500_000;
const MAX_CHUNKS = 1_000;
const CHUNK_TARGET_CHARS = 1_600;
const CHUNK_OVERLAP_CHARS = 180;

type SupportedMime = ProjectDocument['mime_type'];
interface ExtractedSection { text: string; page?: number; section?: number }
interface ImportedDocument { document: ProjectDocument; created: boolean }

export class ProjectDocumentService {
  readonly root: string;

  constructor(root = resolveProjectDocumentRoot()) {
    this.root = path.resolve(root);
    this.ensureRoot();
  }

  async importDocuments(projectId: number, sourcePaths: string[]): Promise<ProjectDocument[]> {
    if (!getProject(projectId)) throw new Error('Document import requires an active Project.');
    const unique = Array.from(new Set(sourcePaths.map(item => path.resolve(item))));
    if (unique.length === 0) return [];
    if (unique.length > MAX_DOCUMENTS_PER_IMPORT) throw new Error(`Import at most ${MAX_DOCUMENTS_PER_IMPORT} documents at once.`);
    const imported: ImportedDocument[] = [];
    try {
      for (const sourcePath of unique) imported.push(await this.importOne(projectId, sourcePath));
      return imported.map(item => item.document);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const item of imported.reverse()) {
        if (!item.created) continue;
        try {
          this.delete(projectId, item.document.id);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'Document import failed and rollback was incomplete.');
      }
      throw error;
    }
  }

  list(projectId: number): ProjectDocument[] {
    return listProjectDocuments(projectId);
  }

  delete(projectId: number, documentId: number): boolean {
    const record = getProjectDocumentStorageRecord(documentId, projectId);
    if (!record) return false;
    this.removeManagedFile(record.storage_path, true);
    return deleteProjectDocumentRecord(documentId, projectId);
  }

  clearAllFiles(): number {
    const rows = getDatabase().prepare('SELECT storage_path FROM project_documents').all() as Array<{ storage_path: string }>;
    let removed = 0;
    for (const row of rows) if (this.removeManagedFile(row.storage_path, true)) removed += 1;
    return removed;
  }

  private async importOne(projectId: number, sourcePath: string): Promise<ImportedDocument> {
    const initialStat = fs.lstatSync(sourcePath);
    if (!initialStat.isFile() || initialStat.isSymbolicLink()) throw new Error('Document source must be a regular file.');
    if (initialStat.size <= 0 || initialStat.size > MAX_DOCUMENT_BYTES) throw new Error('Documents must be between 1 byte and 25 MB.');
    const descriptor = fs.openSync(sourcePath, 'r');
    let bytes: Buffer;
    try {
      const openedStat = fs.fstatSync(descriptor);
      if (!openedStat.isFile() || openedStat.dev !== initialStat.dev || openedStat.ino !== initialStat.ino) {
        throw new Error('Document changed while it was being imported.');
      }
      bytes = fs.readFileSync(descriptor);
      const finalStat = fs.fstatSync(descriptor);
      if (bytes.length !== openedStat.size || finalStat.size !== openedStat.size
        || finalStat.mtimeMs !== openedStat.mtimeMs || finalStat.ctimeMs !== openedStat.ctimeMs) {
        throw new Error('Document changed while it was being imported.');
      }
    } finally {
      fs.closeSync(descriptor);
    }
    const mimeType = detectDocumentMime(sourcePath, bytes);
    if (mimeType.endsWith('wordprocessingml.document') && bytes.length > MAX_DOCX_BYTES) throw new Error('DOCX files are limited to 10 MB.');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const duplicate = getDatabase().prepare('SELECT id FROM project_documents WHERE project_id = ? AND sha256 = ?').get(projectId, sha256) as { id: number } | undefined;
    if (duplicate) {
      const document = getProjectDocument(duplicate.id);
      if (!document) throw new Error('Duplicate document metadata could not be loaded.');
      return { document, created: false };
    }

    const extracted = await extractDocument(mimeType, bytes);
    const chunks = chunkSections(extracted.sections);
    if (chunks.length === 0) throw new Error(mimeType === 'application/pdf' ? 'PDF contains no selectable text; OCR is required.' : 'Document contains no readable text.');
    const extension = extensionFor(mimeType);
    const directory = path.join(this.root, `project-${projectId}`);
    fs.mkdirSync(directory, { recursive: true });
    this.requireManagedDirectory(directory);
    const targetPath = path.join(directory, `${crypto.randomUUID()}.${extension}`);
    fs.writeFileSync(targetPath, bytes, { flag: 'wx' });
    try {
      const document = saveProjectDocument({
        projectId,
        name: cleanName(path.basename(sourcePath)),
        mimeType,
        storagePath: targetPath,
        bytes: bytes.length,
        sha256,
        parser: mimeType === 'application/pdf' ? 'pdfjs' : mimeType.endsWith('wordprocessingml.document') ? 'mammoth' : 'plain-text',
        pageCount: extracted.pageCount,
        chunks,
      });
      return { document, created: true };
    } catch (error) {
      this.removeManagedFile(targetPath, true);
      throw error;
    }
  }

  private ensureRoot(): string {
    fs.mkdirSync(this.root, { recursive: true });
    const stat = fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Document storage root must be a real directory.');
    return fs.realpathSync.native(this.root);
  }

  private requireManagedDirectory(directory: string): string {
    const root = this.ensureRoot();
    const real = fs.realpathSync.native(directory);
    const relative = path.relative(root, real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Document directory escapes managed storage.');
    return real;
  }

  private removeManagedFile(filePath: string, strict: boolean): boolean {
    try {
      const root = this.ensureRoot();
      const resolved = path.resolve(filePath);
      const relative = path.relative(this.root, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Document path is outside managed storage.');
      if (!fs.existsSync(resolved)) return false;
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Document storage path is not a regular file.');
      const real = fs.realpathSync.native(resolved);
      const realRelative = path.relative(root, real);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Document path escapes managed storage.');
      fs.rmSync(real, { force: true });
      return true;
    } catch (error) {
      if (strict) throw error;
      return false;
    }
  }
}

export function resolveProjectDocumentRoot(): string {
  return path.resolve(process.env.ATHENA_DOCUMENT_DIR || path.join(path.dirname(getDatabaseFilePath()), 'documents'));
}

async function extractDocument(mimeType: SupportedMime, bytes: Buffer): Promise<{ sections: ExtractedSection[]; pageCount?: number }> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    const text = decodeUtf8(bytes);
    return { sections: text.split(/\n\s*\n/g).map((value, index) => ({ text: value, section: index + 1 })) };
  }
  if (mimeType.endsWith('wordprocessingml.document')) {
    validateDocxArchive(bytes);
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = normalizeExtractedText(result.value);
    enforceExtractedLimit(text);
    return { sections: text.split(/\n\s*\n/g).map((value, index) => ({ text: value, section: index + 1 })) };
  }
  const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const pdfjs = await importModule('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false });
  const document = await task.promise;
  const pageCount = document.numPages;
  if (pageCount > MAX_PDF_PAGES) throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
  const sections: ExtractedSection[] = [];
  let chars = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeExtractedText(content.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' '));
      page.cleanup();
      if (!text) continue;
      chars += text.length;
      if (chars > MAX_EXTRACTED_CHARS) throw new Error('Extracted document text exceeds the safe limit.');
      sections.push({ text, page: pageNumber });
    }
  } finally {
    await document.destroy();
  }
  return { sections, pageCount };
}

function validateDocxArchive(bytes: Buffer): void {
  const minEocdBytes = 22;
  const searchStart = Math.max(0, bytes.length - minEocdBytes - 0xffff);
  let eocdOffset = -1;
  for (let offset = bytes.length - minEocdBytes; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + minEocdBytes + bytes.readUInt16LE(offset + 20) === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('DOCX archive directory is missing or corrupt.');

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralBytes = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error('Multi-volume DOCX archives are not supported.');
  if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 DOCX archives are not supported.');
  if (entryCount === 0 || entryCount > MAX_DOCX_ENTRIES) throw new Error(`DOCX archive must contain at most ${MAX_DOCX_ENTRIES} entries.`);
  if (centralOffset + centralBytes > eocdOffset) throw new Error('DOCX archive directory is corrupt.');

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('DOCX archive entry is corrupt.');
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedBytes = bytes.readUInt32LE(offset + 24);
    const nameBytes = bytes.readUInt16LE(offset + 28);
    const extraBytes = bytes.readUInt16LE(offset + 30);
    const commentBytes = bytes.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (nextOffset > bytes.length || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) throw new Error('ZIP64 DOCX entries are not supported.');
    if ((flags & 0x1) !== 0) throw new Error('Encrypted DOCX archives are not supported.');
    const name = bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:\//i.test(name) || name.split('/').includes('..')) throw new Error('DOCX archive contains an unsafe entry path.');
    if (uncompressedBytes > MAX_DOCX_ENTRY_BYTES) throw new Error('DOCX archive contains an oversized entry.');
    if (uncompressedBytes > 1_000_000 && compressedBytes > 0 && uncompressedBytes / compressedBytes > MAX_DOCX_COMPRESSION_RATIO) {
      throw new Error('DOCX archive has an unsafe compression ratio.');
    }
    totalUncompressed += uncompressedBytes;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error('DOCX archive expands beyond the safe limit.');
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralBytes) throw new Error('DOCX archive directory size does not match its entries.');
}

function chunkSections(sections: ExtractedSection[]): ProjectDocumentChunkInput[] {
  const chunks: ProjectDocumentChunkInput[] = [];
  for (const section of sections) {
    const normalized = normalizeExtractedText(section.text);
    if (!normalized) continue;
    for (let start = 0; start < normalized.length; start += Math.max(1, CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS)) {
      const text = normalized.slice(start, start + CHUNK_TARGET_CHARS).trim();
      if (!text) continue;
      chunks.push({
        text,
        locator: section.page ? `page ${section.page}` : `section ${section.section || 1}`,
        pageStart: section.page,
        pageEnd: section.page,
      });
      if (chunks.length > MAX_CHUNKS) throw new Error('Document produces too many retrieval chunks.');
      if (start + CHUNK_TARGET_CHARS >= normalized.length) break;
    }
  }
  const chars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (chars > MAX_EXTRACTED_CHARS + chunks.length * CHUNK_OVERLAP_CHARS) throw new Error('Extracted document text exceeds the safe limit.');
  return chunks;
}

function detectDocumentMime(filePath: string, bytes: Buffer): SupportedMime {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (extension === '.docx' && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  throw new Error('Only TXT, Markdown, PDF, and DOCX documents are supported.');
}

function decodeUtf8(bytes: Buffer): string {
  if (bytes.includes(0)) throw new Error('Text document appears to be binary.');
  const text = normalizeExtractedText(bytes.toString('utf8'));
  const replacements = (text.match(/\ufffd/g) || []).length;
  if (replacements > Math.max(4, text.length * 0.01)) throw new Error('Text document is not valid UTF-8.');
  enforceExtractedLimit(text);
  return text;
}

function enforceExtractedLimit(text: string): void {
  if (text.length > MAX_EXTRACTED_CHARS) throw new Error('Extracted document text exceeds the safe limit.');
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanName(value: string): string {
  return (value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim() || 'document').slice(0, 180);
}

function extensionFor(mimeType: SupportedMime): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.endsWith('wordprocessingml.document')) return 'docx';
  if (mimeType === 'text/markdown') return 'md';
  return 'txt';
}
