import * as path from 'path';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Chat attachments accept more than the Project document library does: a
 * spreadsheet, and any file whose bytes are readable UTF-8 text regardless of
 * its extension. The narrower set still governs project_documents, whose table
 * CHECK only knows the original four.
 */
export type ChatDocumentMime =
  | 'text/plain'
  | 'text/markdown'
  | 'application/pdf'
  | typeof DOCX_MIME
  | typeof XLSX_MIME;

/**
 * The extension only chooses between Markdown and plain text — it never decides
 * admission. A .json, .csv, .py or extensionless config all arrive as text/plain
 * with their real name preserved on the attachment record, which is what the
 * model ends up reading.
 */
export function detectChatDocumentMime(filePath: string, bytes: Buffer): ChatDocumentMime {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (isZipContainer(bytes)) {
    if (extension === '.docx') return DOCX_MIME;
    if (extension === '.xlsx') return XLSX_MIME;
    throw new Error('这个压缩容器不是支持的 Office 文件。');
  }
  if (extension === '.pdf') throw new Error('这个文件的扩展名是 PDF，内容却不是。');
  if (!isReadableUtf8Text(bytes)) throw new Error('这个文件不是可读取的文本，也不是支持的文档格式。');
  return extension === '.md' || extension === '.markdown' ? 'text/markdown' : 'text/plain';
}

export function isZipContainer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/**
 * Content, not extension, decides whether a file is text. A NUL byte or a strict
 * decode failure means binary; anything that survives is something a person
 * could have opened in an editor, so it is something worth reading.
 */
export function isReadableUtf8Text(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Audio containers the chat composer transcribes, identified by their magic bytes. */
export function detectAudioMime(filePath: string, bytes: Buffer): 'audio/wav' | 'audio/aiff' | 'audio/flac' | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.wav' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if ((extension === '.aiff' || extension === '.aif') && bytes.subarray(0, 4).toString('ascii') === 'FORM'
    && ['AIFF', 'AIFC'].includes(bytes.subarray(8, 12).toString('ascii'))) return 'audio/aiff';
  if (extension === '.flac' && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  return null;
}
