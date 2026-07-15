import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { load, loadBuffer, type CheerioAPI } from 'cheerio';
import type {
  WebPageEvidence,
  WebPageExtractionMethod,
  WebSearchSource,
} from '../../shared/types';

const PAGE_TIMEOUT_MS = 14_000;
const MAX_REDIRECTS = 4;
const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const MAX_RAW_CONTENT_CHARS = 60_000;
const DEFAULT_EXCERPT_CHARS = 760;
const MIN_CONTENT_CHARS = 120;

interface FetchedDocument {
  url: string;
  contentType: string;
  body: Buffer;
}

interface ExtractionCandidate {
  text: string;
  method: WebPageExtractionMethod;
  score: number;
  title?: string;
  publishedAt?: string;
}

export interface ReadablePageContent {
  title: string;
  text: string;
  excerpt: string;
  method: WebPageExtractionMethod;
  charCount: number;
  publishedAt?: string;
}

export class PageContentExtractor {
  async read(source: WebSearchSource, query: string): Promise<WebPageEvidence | null> {
    try {
      const document = await fetchPublicDocument(source.url);
      const extracted = extractDocument(document, source.title, query);
      if (!extracted || extracted.excerpt.length < 100) return null;

      return {
        sourceId: source.id,
        title: extracted.title || source.title,
        url: document.url,
        excerpt: extracted.excerpt,
        charCount: extracted.charCount,
        extractionMethod: extracted.method,
        extractedAt: new Date().toISOString(),
        publishedAt: extracted.publishedAt,
      };
    } catch {
      return null;
    }
  }
}

export function extractReadableContent(
  input: string | Buffer,
  pageUrl: string,
  query: string,
  maxExcerptChars = DEFAULT_EXCERPT_CHARS,
): ReadablePageContent | null {
  const $ = Buffer.isBuffer(input)
    ? loadBuffer(input, { baseURI: pageUrl })
    : load(input, { baseURI: pageUrl });
  const pageTitle = firstNonEmpty(
    $('meta[property="og:title"]').attr('content'),
    $('meta[name="twitter:title"]').attr('content'),
    $('h1').first().text(),
    $('title').first().text(),
  );
  const pagePublishedAt = firstNonEmpty(
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('meta[name="pubdate"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
  );

  const candidates = extractStructuredCandidates($);
  removeBoilerplate($);
  candidates.push(...extractDomCandidates($));

  if (candidates.length === 0) {
    const fallbackText = extractNodeText($, $('body').first());
    if (fallbackText.length >= MIN_CONTENT_CHARS) {
      candidates.push({
        text: fallbackText,
        method: 'body',
        score: fallbackText.length,
      });
    }
  }

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best || best.text.length < MIN_CONTENT_CHARS) return null;

  const title = cleanLine(best.title || pageTitle || new URL(pageUrl).hostname).slice(0, 240);
  const relevanceQuery = `${query} ${title}`;
  const excerpt = selectRelevantExcerpt(best.text, relevanceQuery, maxExcerptChars);
  if (excerpt.length < 100) return null;

  return {
    title,
    text: best.text,
    excerpt,
    method: best.method,
    charCount: best.text.length,
    publishedAt: cleanOptionalDate(best.publishedAt || pagePublishedAt),
  };
}

export function selectRelevantExcerpt(text: string, query: string, maxChars = DEFAULT_EXCERPT_CHARS): string {
  const limit = Math.max(240, Math.min(1_400, Math.round(maxChars)));
  const units = splitContentUnits(text);
  if (units.length === 0) return '';

  const keywords = extractQueryKeywords(query);
  const scored = units.map((unit, index) => {
    const lower = unit.toLowerCase();
    let score = Math.max(0, 4 - index * 0.35);
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score += keyword.length >= 4 ? 7 : 4;
    }
    if (/\b(?:19|20)\d{2}\b|\d+(?:\.\d+)?%|\d{1,2}[年月日时:：]/.test(unit)) score += 2.5;
    if (/[。！？.!?]/.test(unit)) score += 1;
    if (unit.length >= 45 && unit.length <= 420) score += 2;
    if (isBoilerplateLine(unit)) score -= 12;
    return { unit, index, score };
  });

  const selected: Array<{ unit: string; index: number }> = [];
  let used = 0;
  for (const item of scored.sort((left, right) => right.score - left.score)) {
    if (selected.length >= 12 || used >= limit) break;
    const remaining = limit - used;
    if (remaining < 80 && selected.length > 0) break;
    const value = item.unit.slice(0, remaining);
    if (value.length < 35 && selected.length > 0) continue;
    selected.push({ unit: value, index: item.index });
    used += value.length + 1;
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map(item => item.unit)
    .join('\n')
    .slice(0, limit)
    .trim();
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpAddress(normalized.slice('::ffff:'.length));
  }

  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map(Number);
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (version === 6) {
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

async function fetchPublicDocument(initialUrl: string): Promise<FetchedDocument> {
  let currentUrl = new URL(initialUrl);
  const deadline = Date.now() + PAGE_TIMEOUT_MS;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicUrl(currentUrl);
    const remainingMs = deadline - Date.now();
    if (remainingMs < 500) throw new Error('网页读取超时。');

    const response = await fetch(currentUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.2',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AthenaResearch/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(remainingMs),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error('网页重定向过多。');
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (!response.ok) throw new Error(`网页返回 ${response.status}。`);

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!isReadableContentType(contentType)) throw new Error(`暂不支持正文类型：${contentType || 'unknown'}`);
    const body = await readResponseBody(response, MAX_DOCUMENT_BYTES);
    return { url: currentUrl.toString(), contentType, body };
  }

  throw new Error('网页重定向失败。');
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许读取 HTTP 网页。');
  if (url.username || url.password) throw new Error('网页地址不能包含认证信息。');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('网页端口不在允许范围内。');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('拒绝读取本地地址。');
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) throw new Error('拒绝读取内网地址。');
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(item => isPrivateIpAddress(item.address))) {
    throw new Error('网页域名解析到了内网地址。');
  }
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('网页正文过大。');
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('网页正文过大。');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function extractDocument(document: FetchedDocument, fallbackTitle: string, query: string): ReadablePageContent | null {
  if (document.contentType.includes('json')) {
    try {
      const value = JSON.parse(document.body.toString('utf8')) as unknown;
      const text = findLongestStructuredText(value);
      if (text.length < MIN_CONTENT_CHARS) return null;
      return {
        title: fallbackTitle,
        text,
        excerpt: selectRelevantExcerpt(text, `${query} ${fallbackTitle}`),
        method: 'json',
        charCount: text.length,
      };
    } catch {
      return null;
    }
  }

  if (document.contentType.includes('text/plain')) {
    const text = cleanLongText(document.body.toString('utf8'));
    if (text.length < MIN_CONTENT_CHARS) return null;
    return {
      title: fallbackTitle,
      text,
      excerpt: selectRelevantExcerpt(text, `${query} ${fallbackTitle}`),
      method: 'text',
      charCount: text.length,
    };
  }

  return extractReadableContent(document.body, document.url, query);
}

function extractStructuredCandidates($: CheerioAPI): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw || raw.length > 1_500_000) return;
    try {
      collectJsonLdCandidates(JSON.parse(raw) as unknown, candidates);
    } catch {
      // Invalid JSON-LD is common and should not block normal DOM extraction.
    }
  });

  $('script#__NEXT_DATA__, script[type="application/json"]').each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw || raw.length > 1_500_000) return;
    try {
      const text = findLongestStructuredText(JSON.parse(raw) as unknown);
      if (text.length >= 240) {
        candidates.push({ text, method: 'json', score: text.length + 1_600 });
      }
    } catch {
      // Hydration data is optional.
    }
  });

  return candidates;
}

function collectJsonLdCandidates(value: unknown, candidates: ExtractionCandidate[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdCandidates(item, candidates, depth + 1);
    return;
  }

  const record = value as Record<string, unknown>;
  const body = typeof record.articleBody === 'string' ? cleanMaybeHtml(record.articleBody) : '';
  if (body.length >= MIN_CONTENT_CHARS) {
    candidates.push({
      text: body,
      method: 'json-ld',
      score: body.length + 2_600,
      title: typeof record.headline === 'string' ? record.headline : undefined,
      publishedAt: typeof record.datePublished === 'string' ? record.datePublished : undefined,
    });
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectJsonLdCandidates(nested, candidates, depth + 1);
  }
}

function findLongestStructuredText(value: unknown): string {
  const preferredKeys = new Set(['articleBody', 'article_body', 'body', 'content', 'text', 'description']);
  let best = '';
  let visited = 0;

  const visit = (node: unknown, depth: number, key = ''): void => {
    if (depth > 9 || visited > 6_000 || node === null || node === undefined) return;
    visited += 1;
    if (typeof node === 'string') {
      if (preferredKeys.has(key) && node.length > best.length) best = cleanMaybeHtml(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1, key);
      return;
    }
    if (typeof node === 'object') {
      for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
        visit(child, depth + 1, childKey);
      }
    }
  };

  visit(value, 0);
  return best.slice(0, MAX_RAW_CONTENT_CHARS);
}

function removeBoilerplate($: CheerioAPI): void {
  $('script,style,noscript,template,svg,canvas,iframe,form,button,input,select,textarea,nav,aside,footer').remove();
  $('[aria-hidden="true"], [hidden]').remove();
  $('[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], [class*="sidebar"], [id*="sidebar"], [class*="recommend"], [class*="related"], [class*="advert"], [class*="share"], [class*="comment"]').remove();
}

function extractDomCandidates($: CheerioAPI): ExtractionCandidate[] {
  const definitions: Array<{ selector: string; method: WebPageExtractionMethod; bonus: number }> = [
    { selector: '[itemprop="articleBody"]', method: 'article', bonus: 2_400 },
    { selector: 'article', method: 'article', bonus: 2_100 },
    { selector: 'main', method: 'main', bonus: 1_700 },
    { selector: '[role="main"]', method: 'main', bonus: 1_600 },
    { selector: '[class*="article-content"], [class*="article_body"], [class*="post-content"], [class*="entry-content"]', method: 'semantic', bonus: 1_900 },
    { selector: '[id*="article"], [id*="content"], [class*="story"], [class*="detail"], [class*="news-content"]', method: 'semantic', bonus: 1_250 },
    { selector: '[class*="content"]', method: 'semantic', bonus: 550 },
  ];
  const candidates: ExtractionCandidate[] = [];
  const seen = new WeakSet<object>();

  for (const definition of definitions) {
    $(definition.selector).slice(0, 24).each((_index, element) => {
      if (seen.has(element)) return;
      seen.add(element);
      const node = $(element);
      const text = extractNodeText($, node);
      if (text.length < MIN_CONTENT_CHARS) return;
      const linkTextLength = cleanLongText(node.find('a').text()).length;
      const linkDensity = Math.min(1, linkTextLength / Math.max(1, text.length));
      const paragraphCount = node.find('p').length;
      const punctuationCount = (text.match(/[。！？.!?]/g) || []).length;
      const score = text.length
        + definition.bonus
        + Math.min(30, paragraphCount) * 85
        + Math.min(80, punctuationCount) * 10
        - Math.round(text.length * linkDensity * 0.9);
      candidates.push({ text, method: definition.method, score });
    });
  }

  return candidates;
}

function extractNodeText($: CheerioAPI, node: ReturnType<CheerioAPI>): string {
  const clone = node.clone();
  clone.find('script,style,noscript,template,svg,canvas,iframe,form,button,input,select,textarea,nav,aside,footer').remove();
  clone.find('br').replaceWith('\n');

  const lines: string[] = [];
  clone.find('h1,h2,h3,h4,p,li,blockquote,pre,table tr').each((_index, element) => {
    const current = $(element);
    let value = '';
    if (element.tagName?.toLowerCase() === 'tr') {
      value = current.find('th,td').map((_cellIndex, cell) => cleanLine($(cell).text())).get().filter(Boolean).join(' | ');
    } else {
      value = cleanLine(current.text());
    }
    if (value && !isBoilerplateLine(value)) lines.push(value);
  });

  if (lines.join('').length < MIN_CONTENT_CHARS) {
    const fallback = cleanLongText(clone.text());
    if (fallback) lines.push(fallback);
  }
  return dedupeLines(lines).join('\n').slice(0, MAX_RAW_CONTENT_CHARS);
}

function splitContentUnits(text: string): string[] {
  const rawLines = text.split(/\n+/).map(cleanLine).filter(Boolean);
  const units: string[] = [];
  for (const line of rawLines) {
    if (line.length <= 520) {
      units.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[。！？.!?])\s*/).map(cleanLine).filter(Boolean);
    units.push(...sentences);
  }
  return dedupeLines(units).filter(unit => unit.length >= 20);
}

function extractQueryKeywords(query: string): string[] {
  const normalized = query.toLowerCase();
  const keywords = new Set<string>();
  const englishStop = new Set(['about', 'latest', 'news', 'today', 'current', 'official', 'please', 'what', 'with', 'from']);
  for (const token of normalized.match(/[a-z0-9][a-z0-9._+-]{2,}/g) || []) {
    if (!englishStop.has(token)) keywords.add(token);
  }

  const chineseStop = new Set(['什么', '怎么', '一下', '帮我', '最新', '今天', '目前', '现在', '新闻', '消息', '详细', '官方']);
  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) || []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!chineseStop.has(bigram)) keywords.add(bigram);
    }
  }
  return Array.from(keywords).slice(0, 24);
}

function cleanMaybeHtml(value: string): string {
  if (!/[<>]/.test(value)) return cleanLongText(value);
  return cleanLongText(load(`<body>${value}</body>`)('body').text());
}

function cleanLongText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_RAW_CONTENT_CHARS);
}

function cleanLine(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(line);
  }
  return result;
}

function isBoilerplateLine(value: string): boolean {
  if (value.length > 150) return false;
  return /^(?:登录|注册|首页|返回顶部|点击查看|查看更多|展开全文|分享|收藏|关注|下载客户端|打开app|广告|相关阅读|推荐阅读|评论|隐私政策|用户协议|copyright|sign in|log in|subscribe|accept cookies?)\b/i.test(value.trim());
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.map(value => cleanLine(value || '')).find(Boolean) || '';
}

function cleanOptionalDate(value: string): string | undefined {
  const cleaned = cleanLine(value);
  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function isReadableContentType(contentType: string): boolean {
  return !contentType
    || contentType.includes('text/html')
    || contentType.includes('application/xhtml+xml')
    || contentType.includes('text/plain')
    || contentType.includes('application/json')
    || contentType.includes('text/json');
}
