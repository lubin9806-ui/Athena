import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export type DocumentArtifactFormat = 'markdown' | 'html' | 'docx' | 'pdf';

export interface DocumentSectionInput {
  heading?: string;
  body: string;
}

export interface DocumentArtifactInput {
  title: string;
  sections: DocumentSectionInput[];
  format: DocumentArtifactFormat;
}

export interface PdfRenderer {
  render(html: string, signal: AbortSignal): Promise<Buffer>;
}

export interface RenderedDocument {
  bytes: Buffer;
  extension: string;
  contentType: string;
  validate: (bytes: Buffer) => void;
}

const MAX_DOCUMENT_CHARS = 200_000;

export class DocumentArtifactService {
  constructor(private readonly pdfRenderer: PdfRenderer) {}

  async render(input: DocumentArtifactInput, signal: AbortSignal): Promise<RenderedDocument> {
    const normalized = normalizeDocument(input);
    throwIfAborted(signal);
    if (normalized.format === 'markdown') {
      return textDocument(renderMarkdown(normalized), 'md', 'text/markdown; charset=utf-8');
    }
    if (normalized.format === 'html') {
      return textDocument(renderHtml(normalized), 'html', 'text/html; charset=utf-8');
    }
    if (normalized.format === 'docx') {
      const document = new Document({
        sections: [{
          children: [
            new Paragraph({ text: normalized.title, heading: HeadingLevel.TITLE }),
            ...normalized.sections.flatMap(section => [
              ...(section.heading ? [new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 })] : []),
              ...section.body.split(/\r?\n/).map(line => new Paragraph({ children: [new TextRun(line || ' ')] })),
            ]),
          ],
        }],
      });
      const bytes = await Packer.toBuffer(document);
      throwIfAborted(signal);
      return {
        bytes,
        extension: 'docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        validate: validateDocx,
      };
    }
    const bytes = await this.pdfRenderer.render(renderHtml(normalized), signal);
    return { bytes, extension: 'pdf', contentType: 'application/pdf', validate: validatePdf };
  }
}

function normalizeDocument(input: DocumentArtifactInput): DocumentArtifactInput {
  const title = requireText(input.title, 'Document title', 500);
  if (!['markdown', 'html', 'docx', 'pdf'].includes(input.format)) throw new Error('Unsupported document format');
  if (!Array.isArray(input.sections) || input.sections.length === 0 || input.sections.length > 100) {
    throw new Error('Document requires between 1 and 100 sections');
  }
  let total = title.length;
  const sections = input.sections.map((section, index) => {
    const body = requireText(section?.body, `Section ${index + 1} body`, MAX_DOCUMENT_CHARS);
    const heading = cleanText(section?.heading, 500);
    total += body.length + heading.length;
    return { ...(heading ? { heading } : {}), body };
  });
  if (total > MAX_DOCUMENT_CHARS) throw new Error(`Document exceeds ${MAX_DOCUMENT_CHARS} characters`);
  return { title, sections, format: input.format };
}

function renderMarkdown(input: DocumentArtifactInput): string {
  const sections = input.sections.map(section => [
    section.heading ? `## ${section.heading}` : '',
    section.body,
  ].filter(Boolean).join('\n\n'));
  return `# ${input.title}\n\n${sections.join('\n\n')}\n`;
}

function renderHtml(input: DocumentArtifactInput): string {
  const sections = input.sections.map(section => `<section>${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}${section.body
    .split(/\r?\n\r?\n/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('')}</section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(input.title)}</title><style>@page{size:A4;margin:20mm}body{font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#1d2421;font-size:11pt;line-height:1.65;max-width:760px;margin:0 auto}h1{font-size:25pt;margin:0 0 18mm}h2{font-size:15pt;margin:9mm 0 3mm}p{margin:0 0 4mm;white-space:normal;overflow-wrap:anywhere}</style></head><body><h1>${escapeHtml(input.title)}</h1>${sections}</body></html>`;
}

function textDocument(content: string, extension: string, contentType: string): RenderedDocument {
  const bytes = Buffer.from(content, 'utf8');
  return { bytes, extension, contentType, validate: validateNonEmptyText };
}

function validateNonEmptyText(bytes: Buffer): void {
  if (!bytes.length || !bytes.toString('utf8').trim()) throw new Error('Generated text document is empty');
}

function validateDocx(bytes: Buffer): void {
  if (bytes.length < 1_024 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('Generated DOCX is not a valid OOXML ZIP container');
  }
}

function validatePdf(bytes: Buffer): void {
  if (bytes.length < 1_024 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-1_024).includes(Buffer.from('%%EOF'))) {
    throw new Error('Generated PDF failed signature validation');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  const text = cleanText(raw, maxLength);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Document generation was cancelled');
}
