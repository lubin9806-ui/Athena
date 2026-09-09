import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_FOLDER_ENTRIES_SCANNED = 500;

/**
 * Extensions worth pulling out of a dropped folder. A file dropped on its own is
 * admitted on its content, but a folder must not sweep in every binary that
 * happens to sit next to the documents.
 */
const FOLDER_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.txt', '.md', '.markdown', '.pdf', '.docx', '.xlsx',
  '.json', '.csv', '.log', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts', '.py', '.ps1', '.ini', '.toml',
  '.wav', '.aiff', '.aif', '.flac',
]);

export interface ExpandedDrop {
  files: string[];
  /** Named so the person is told what was left out instead of it vanishing quietly. */
  skipped: string[];
  overflow: boolean;
}

/**
 * Turns what was dropped into the list of files to import: folders contribute
 * their supported entries in name order, and the whole thing is capped at the
 * per-message limit rather than failing once it is exceeded.
 */
export function expandDroppedPaths(paths: string[], maxFiles: number): ExpandedDrop {
  const files: string[] = [];
  const skipped: string[] = [];
  let overflow = false;

  for (const candidate of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(candidate);
    } catch {
      skipped.push(path.basename(candidate));
      continue;
    }
    if (stat.isSymbolicLink()) {
      skipped.push(path.basename(candidate));
      continue;
    }
    if (stat.isDirectory()) {
      const { accepted, ignored } = readFolder(candidate);
      skipped.push(...ignored);
      for (const file of accepted) {
        if (files.length >= maxFiles) { overflow = true; break; }
        files.push(file);
      }
      continue;
    }
    if (!stat.isFile()) {
      skipped.push(path.basename(candidate));
      continue;
    }
    if (files.length >= maxFiles) { overflow = true; continue; }
    files.push(candidate);
  }

  return { files, skipped, overflow };
}

function readFolder(directory: string): { accepted: string[]; ignored: string[] } {
  const accepted: string[] = [];
  const ignored: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return { accepted, ignored: [path.basename(directory)] };
  }
  for (const entry of entries.slice(0, MAX_FOLDER_ENTRIES_SCANNED)) {
    if (!entry.isFile()) continue;
    if (FOLDER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) accepted.push(path.join(directory, entry.name));
    else ignored.push(entry.name);
  }
  accepted.sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'zh-CN'));
  return { accepted, ignored };
}

/** Writes dropped text into a staging file so it can take the ordinary import path. */
export function writeDroppedText(text: string, stagingDir: string, name = '拖入的文本'): string {
  fs.mkdirSync(stagingDir, { recursive: true });
  const safeName = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 60) || 'text';
  const target = path.join(stagingDir, `${safeName}-${crypto.randomUUID().slice(0, 8)}.txt`);
  fs.writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' });
  return target;
}

/**
 * Fetches an image dragged out of a web page. The caller is responsible for
 * having checked network consent first — this only enforces what a download must
 * not do: no non-http schemes, no unbounded body, no non-image payload.
 */
export async function downloadDroppedImage(url: string, stagingDir: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http/https 的图片地址。');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'follow' });
  } catch (error) {
    throw new Error(`图片下载失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error('这张网络图片超过 10 MB。');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0) throw new Error('下载到的图片是空的。');
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('这张网络图片超过 10 MB。');

  const extension = sniffImageExtension(bytes);
  if (!extension) throw new Error('下载到的内容不是支持的图片格式。');

  fs.mkdirSync(stagingDir, { recursive: true });
  const baseName = (path.basename(parsed.pathname) || 'image').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 60);
  const stem = baseName.includes('.') ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName;
  const target = path.join(stagingDir, `${stem || 'image'}-${crypto.randomUUID().slice(0, 8)}.${extension}`);
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return target;
}

/** Format from the bytes themselves; a URL's extension and a server's content-type both lie. */
export function sniffImageExtension(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM') return 'bmp';
  return null;
}
