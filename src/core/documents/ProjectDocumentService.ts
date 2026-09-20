import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import { createCanvas } from '@napi-rs/canvas';
import { validateOoxmlArchive } from './OoxmlArchive';
import { extractSpreadsheetText } from './SpreadsheetText';
import { detectChatDocumentMime, type ChatDocumentMime } from './DocumentMime';
import {
  deleteProjectDocumentRecord,
  getDatabase,
  getDatabaseFilePath,
  getProject,
  getProjectDocument,
  getProjectDocumentStorageRecord,
  listProjectDocuments,
  saveProjectDocument,
  updateProjectDocumentExtraction,
  type ProjectDocumentChunkInput,
} from '../../memory';
import type { ProjectDocument } from '../../shared/types';
import type { LocalOcrService } from '../ocr';

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS_PER_IMPORT = 5;
const MAX_PDF_PAGES = 300;
const MAX_OCR_PDF_PAGES = 20;
const MAX_OCR_PDFS_PER_IMPORT = 3;
const MAX_EXTRACTED_CHARS = 1_500_000;
const MAX_CHAT_ATTACHMENT_CHARS = 120_000;
const MAX_CHUNKS = 1_000;
const CHUNK_TARGET_CHARS = 1_600;
const CHUNK_OVERLAP_CHARS = 180;

type SupportedMime = ProjectDocument['mime_type'];
interface ExtractedSection { text: string; page?: number; section?: number }
interface ImportedDocument { document: ProjectDocument; created: boolean; rollback?: () => void }
interface DocumentImportOptions { ocrMissingPages: boolean; signal?: AbortSignal }
interface ExtractedDocument {
  sections: ExtractedSection[];
  pageCount?: number;
  needsOcr?: boolean;
  ocrEngine?: ProjectDocument['ocr_engine'];
  ocrLanguages?: string[];
}

export interface ProjectDocumentServiceOptions {
  root?: string;
  ocr?: LocalOcrService;
}

export interface ChatDocumentExtraction {
  mimeType: ChatDocumentMime;
  text: string;
  sha256: string;
}

export class ProjectDocumentService {
  readonly root: string;
  private readonly ocr?: LocalOcrService;

  constructor(options: ProjectDocumentServiceOptions = {}) {
    this.root = path.resolve(options.root || resolveProjectDocumentRoot());
    this.ocr = options.ocr;
    this.ensureRoot();
  }

  async importDocuments(projectId: number, sourcePaths: string[]): Promise<ProjectDocument[]> {
    return this.importBatch(projectId, sourcePaths, { ocrMissingPages: false });
  }

  async importScannedPdfs(projectId: number, sourcePaths: string[], signal?: AbortSignal): Promise<ProjectDocument[]> {
    if (sourcePaths.length > MAX_OCR_PDFS_PER_IMPORT) throw new Error(`OCR at most ${MAX_OCR_PDFS_PER_IMPORT} PDFs at once.`);
    if (sourcePaths.some(source => path.extname(source).toLowerCase() !== '.pdf')) throw new Error('Local document OCR accepts PDF files only.');
    if (!this.ocr) throw new Error('Local OCR service is unavailable.');
    return this.importBatch(projectId, sourcePaths, { ocrMissingPages: true, signal });
  }

  private async importBatch(projectId: number, sourcePaths: string[], options: DocumentImportOptions): Promise<ProjectDocument[]> {
    if (!getProject(projectId)) throw new Error('Document import requires an active Project.');
    const unique = Array.from(new Set(sourcePaths.map(item => path.resolve(item))));
    if (unique.length === 0) return [];
    if (unique.length > MAX_DOCUMENTS_PER_IMPORT) throw new Error(`Import at most ${MAX_DOCUMENTS_PER_IMPORT} documents at once.`);
    const imported: ImportedDocument[] = [];
    try {
      for (const sourcePath of unique) imported.push(await this.importOne(projectId, sourcePath, options));
      return imported.map(item => item.document);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const item of imported.reverse()) {
        try {
          if (item.created) this.delete(projectId, item.document.id);
          else item.rollback?.();
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

  private async importOne(projectId: number, sourcePath: string, options: DocumentImportOptions): Promise<ImportedDocument> {
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
      if (options.ocrMissingPages && document.needs_ocr) {
        const previousExtraction = snapshotExtraction(document, projectId);
        const extracted = await extractDocument(mimeType, bytes, this.ocr, options);
        const chunks = chunkSections(extracted.sections);
        if (chunks.length === 0) throw new Error('Local OCR found no readable text in the PDF.');
        return {
          document: updateProjectDocumentExtraction(document.id, projectId, {
            pageCount: extracted.pageCount,
            chunks,
            ocrEngine: extracted.ocrEngine,
            ocrLanguages: extracted.ocrLanguages,
            needsOcr: extracted.needsOcr,
          }),
          created: false,
          rollback: () => { updateProjectDocumentExtraction(document.id, projectId, previousExtraction); },
        };
      }
      return { document, created: false };
    }

    const extracted = await extractDocument(mimeType, bytes, this.ocr, options);
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
        ocrEngine: extracted.ocrEngine,
        ocrLanguages: extracted.ocrLanguages,
        needsOcr: extracted.needsOcr,
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

function snapshotExtraction(
  document: ProjectDocument,
  projectId: number,
): Parameters<typeof updateProjectDocumentExtraction>[2] {
  const rows = getDatabase().prepare(`
    SELECT locator, page_start, page_end, text
    FROM project_document_chunks
    WHERE document_id = ? AND project_id = ?
    ORDER BY ordinal ASC
  `).all(document.id, projectId) as Array<{ locator: string; page_start: number | null; page_end: number | null; text: string }>;
  return {
    pageCount: document.page_count,
    ocrEngine: document.ocr_engine,
    ocrLanguages: document.ocr_languages,
    needsOcr: document.needs_ocr,
    chunks: rows.map(row => ({
      locator: row.locator,
      pageStart: row.page_start || undefined,
      pageEnd: row.page_end || undefined,
      text: row.text,
    })),
  };
}

export function resolveProjectDocumentRoot(): string {
  return path.resolve(process.env.ATHENA_DOCUMENT_DIR || path.join(path.dirname(getDatabaseFilePath()), 'documents'));
}

export async function extractChatDocument(sourcePath: string): Promise<ChatDocumentExtraction> {
  const resolved = path.resolve(sourcePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Document source must be a regular file.');
  if (stat.size <= 0 || stat.size > MAX_DOCUMENT_BYTES) throw new Error('Documents must be between 1 byte and 25 MB.');
  const bytes = fs.readFileSync(resolved);
  if (bytes.length !== stat.size) throw new Error('Document changed while it was being read.');
  const mimeType = detectChatDocumentMime(resolved, bytes);
  if (mimeType.endsWith('wordprocessingml.document') && bytes.length > MAX_DOCX_BYTES) throw new Error('DOCX 文件最大 10 MB。');
  if (mimeType.endsWith('spreadsheetml.sheet') && bytes.length > MAX_XLSX_BYTES) throw new Error('XLSX 文件最大 10 MB。');
  const extracted = await extractDocument(mimeType, bytes, undefined, { ocrMissingPages: false });
  const rendered = extracted.sections
    .map(section => {
      const locator = section.page ? `第 ${section.page} 页` : `第 ${section.section || 1} 节`;
      return `[${locator}]\n${normalizeExtractedText(section.text)}`;
    })
    .filter(Boolean)
    .join('\n\n');
  if (!rendered.trim()) {
    throw new Error(mimeType === 'application/pdf' ? 'PDF 没有可读取的文本，请先使用 OCR。' : '文档没有可读取的文本。');
  }
  const truncated = rendered.length > MAX_CHAT_ATTACHMENT_CHARS;
  return {
    mimeType,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    text: truncated
      ? `${rendered.slice(0, MAX_CHAT_ATTACHMENT_CHARS)}\n\n[附件内容过长，已截取前 ${MAX_CHAT_ATTACHMENT_CHARS} 个字符]`
      : rendered,
  };
}

async function extractDocument(
  mimeType: ChatDocumentMime,
  bytes: Buffer,
  ocr: LocalOcrService | undefined,
  options: DocumentImportOptions,
): Promise<ExtractedDocument> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    const text = decodeUtf8(bytes);
    return { sections: text.split(/\n\s*\n/g).map((value, index) => ({ text: value, section: index + 1 })) };
  }
  if (mimeType.endsWith('spreadsheetml.sheet')) {
    const text = normalizeExtractedText(await extractSpreadsheetText(bytes));
    enforceExtractedLimit(text);
    return { sections: text.split(/\n\s*\n/g).map((value, index) => ({ text: value, section: index + 1 })) };
  }
  if (mimeType.endsWith('wordprocessingml.document')) {
    validateOoxmlArchive(bytes, 'DOCX');
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = normalizeExtractedText(result.value);
    enforceExtractedLimit(text);
    return { sections: text.split(/\n\s*\n/g).map((value, index) => ({ text: value, section: index + 1 })) };
  }
  const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const pdfjs = await importModule('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false });
  const sections: ExtractedSection[] = [];
  const missingPages: Array<{ page: number; bytes: Buffer }> = [];
  let chars = 0;
  let pageCount = 0;
  try {
    const document = await task.promise;
    pageCount = document.numPages;
    if (pageCount > MAX_PDF_PAGES) throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
    if (options.ocrMissingPages && pageCount > MAX_OCR_PDF_PAGES) throw new Error(`Local OCR PDFs are limited to ${MAX_OCR_PDF_PAGES} pages.`);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = normalizeExtractedText(content.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' '));
        if (text) {
          chars += text.length;
          if (chars > MAX_EXTRACTED_CHARS) throw new Error('Extracted document text exceeds the safe limit.');
          sections.push({ text, page: pageNumber });
        } else if (options.ocrMissingPages) {
          missingPages.push({ page: pageNumber, bytes: await renderPdfPage(page) });
        }
      } finally {
        page.cleanup();
      }
    }
    if (missingPages.length > 0) {
      if (!ocr) throw new Error('Local OCR service is unavailable.');
      const recognized = await ocr.recognize(missingPages.map(item => ({ bytes: item.bytes, label: `page ${item.page}` })), options.signal);
      recognized.forEach((result, index) => {
        if (!result.text) return;
        chars += result.text.length;
        if (chars > MAX_EXTRACTED_CHARS) throw new Error('Extracted document text exceeds the safe limit.');
        sections.push({ text: result.text, page: missingPages[index].page });
      });
    }
  } finally {
    await task.destroy();
  }
  sections.sort((left, right) => (left.page || 0) - (right.page || 0));
  return {
    sections,
    pageCount,
    needsOcr: new Set(sections.map(section => section.page)).size < pageCount,
    ...(missingPages.length > 0 ? { ocrEngine: 'tesseract.js' as const, ocrLanguages: ['chi_sim', 'eng'] } : {}),
  };
}

async function renderPdfPage(page: any): Promise<Buffer> {
  const base = page.getViewport({ scale: 1 });
  const maxScaleByEdge = 2_400 / Math.max(base.width, base.height);
  const maxScaleByPixels = Math.sqrt(6_000_000 / Math.max(1, base.width * base.height));
  const scale = Math.max(0.25, Math.min(2, maxScaleByEdge, maxScaleByPixels));
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
  const bytes = canvas.toBuffer('image/png');
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Rendered PDF page exceeds the OCR image limit.');
  return bytes;
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
