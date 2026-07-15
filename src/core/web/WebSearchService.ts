import type {
  WebSearchContext,
  WebPageEvidence,
  WebSearchProvider,
  WebSearchSettings,
  WebSearchSource,
  WebSearchStatus,
} from '../../shared/types';
import { PageContentExtractor } from './PageContentExtractor';

type ActiveSearchProvider = Exclude<WebSearchProvider, 'none'>;

interface SearchEndpoint {
  provider: ActiveSearchProvider;
  url: string;
  queryParam: 'q' | 'keyword';
  timeoutMs: number;
  parser: (html: string, maxResults: number) => WebSearchSource[];
  mobile?: boolean;
}

const SEARCH_ENDPOINTS: readonly SearchEndpoint[] = [
  {
    provider: 'sogou',
    url: 'https://m.sogou.com/web/searchList.jsp',
    queryParam: 'keyword',
    timeoutMs: 9_000,
    parser: parseSogouMobileHtml,
    mobile: true,
  },
  {
    provider: 'bing',
    url: 'https://cn.bing.com/search',
    queryParam: 'q',
    timeoutMs: 9_000,
    parser: parseBingHtml,
  },
  {
    provider: 'duckduckgo',
    url: 'https://html.duckduckgo.com/html/',
    queryParam: 'q',
    timeoutMs: 10_000,
    parser: parseDuckDuckGoHtml,
  },
  {
    provider: 'duckduckgo',
    url: 'https://lite.duckduckgo.com/lite/',
    queryParam: 'q',
    timeoutMs: 10_000,
    parser: parseDuckDuckGoHtml,
  },
] as const;
const MAX_SEARCH_HTML_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_CHARS = 500;

export interface WebSearchPlanInput {
  message: string;
  force?: boolean;
  settings: WebSearchSettings;
  detectedAction?: {
    type: string;
    param: string;
  } | null;
}

export interface WebSearchPlan {
  shouldSearch: boolean;
  query: string;
  reason: 'disabled' | 'manual' | 'forced' | 'explicit' | 'freshness';
}

export class WebSearchService {
  constructor(private readonly pageExtractor = new PageContentExtractor()) {}

  plan(input: WebSearchPlanInput): WebSearchPlan {
    const message = cleanQuery(input.message);
    if (!input.settings.enabled) {
      return { shouldSearch: false, query: message, reason: 'disabled' };
    }

    const explicitRequest = isExplicitSearchRequest(message);
    const actionQuery = input.detectedAction?.type === 'search' && explicitRequest
      ? cleanQuery(input.detectedAction.param)
      : '';
    const query = actionQuery || extractSearchQuery(message);

    if (input.force) {
      return { shouldSearch: Boolean(query), query, reason: 'forced' };
    }
    if (explicitRequest) {
      return { shouldSearch: Boolean(query), query, reason: 'explicit' };
    }
    if (input.settings.mode !== 'auto') {
      return { shouldSearch: false, query, reason: 'manual' };
    }

    return {
      shouldSearch: shouldAutoSearch(message, input.detectedAction?.type),
      query,
      reason: 'freshness',
    };
  }

  async search(
    query: string,
    maxResults: number,
    onStatus?: (status: WebSearchStatus) => void,
  ): Promise<WebSearchContext> {
    const cleanedQuery = cleanQuery(query);
    if (!cleanedQuery) throw new Error('搜索词为空。');

    onStatus?.({ phase: 'searching', query: cleanedQuery });
    try {
      const context = await this.searchAcrossProviders(cleanedQuery, clamp(maxResults, 3, 8));
      onStatus?.({
        phase: 'done',
        query: cleanedQuery,
        resultCount: context.sources.length,
        provider: context.provider,
        searchRound: 1,
      });
      return context;
    } catch (error) {
      const message = error instanceof Error ? error.message : '联网搜索失败。';
      onStatus?.({ phase: 'failed', query: cleanedQuery, message });
      throw new Error(message);
    }
  }

  async research(
    query: string,
    settings: WebSearchSettings,
    onStatus?: (status: WebSearchStatus) => void,
  ): Promise<WebSearchContext> {
    const cleanedQuery = cleanQuery(query);
    if (!cleanedQuery) throw new Error('搜索词为空。');

    const maxResults = clamp(settings.maxResults, 3, 8);
    const maxPages = clamp(settings.maxPages, 1, 4);
    const useSecondarySearch = settings.secondarySearch && maxResults >= 3;
    const initialLimit = useSecondarySearch
      ? Math.max(2, Math.ceil(maxResults * 0.6))
      : maxResults;

    onStatus?.({ phase: 'searching', query: cleanedQuery, searchRound: 1 });
    let initial: WebSearchContext;
    try {
      initial = await this.searchAcrossProviders(cleanedQuery, initialLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : '联网搜索失败。';
      onStatus?.({ phase: 'failed', query: cleanedQuery, message });
      throw new Error(message);
    }

    let sources = reindexSources(initial.sources, maxResults);
    let pages: WebPageEvidence[] = [];
    const providers: WebSearchProvider[] = [initial.provider];
    const secondaryQueries: string[] = [];
    let searchRounds = 1;

    if (settings.deepRead) {
      const firstReadLimit = useSecondarySearch ? Math.max(1, maxPages - 1) : maxPages;
      onStatus?.({
        phase: 'reading',
        query: cleanedQuery,
        pageCount: Math.min(firstReadLimit, sources.length),
        searchRound: 1,
        provider: initial.provider,
      });
      pages = await this.readSources(sources, cleanedQuery, firstReadLimit);
    }

    if (useSecondarySearch) {
      const secondaryQuery = buildSecondarySearchQuery(cleanedQuery, sources, pages);
      secondaryQueries.push(secondaryQuery);
      onStatus?.({
        phase: 'refining',
        query: secondaryQuery,
        pageCount: pages.length,
        searchRound: 2,
        message: secondaryQuery,
      });

      const remainingResults = Math.max(1, maxResults - sources.length);
      try {
        const secondary = await this.searchAcrossProviders(secondaryQuery, remainingResults, initial.provider);
        searchRounds = 2;
        if (!providers.includes(secondary.provider)) providers.push(secondary.provider);
        const previousUrls = new Set(sources.map(source => canonicalUrlKey(source.url)));
        sources = mergeSources(sources, secondary.sources, maxResults);

        if (settings.deepRead && pages.length < maxPages) {
          const newSources = sources.filter(source => !previousUrls.has(canonicalUrlKey(source.url)));
          const remainingPages = maxPages - pages.length;
          if (newSources.length > 0 && remainingPages > 0) {
            onStatus?.({
              phase: 'reading',
              query: secondaryQuery,
              pageCount: Math.min(remainingPages, newSources.length),
              searchRound: 2,
              provider: secondary.provider,
            });
            pages.push(...await this.readSources(newSources, secondaryQuery, remainingPages));
          }
        }
      } catch {
        // A failed refinement must not discard the useful first-round evidence.
      }
    }

    const context: WebSearchContext = {
      query: cleanedQuery,
      provider: initial.provider,
      searchedAt: new Date().toISOString(),
      sources,
      pages,
      secondaryQueries,
      providers,
      searchRounds,
    };
    onStatus?.({
      phase: 'done',
      query: cleanedQuery,
      resultCount: sources.length,
      pageCount: pages.length,
      searchRound: searchRounds,
      provider: initial.provider,
    });
    return context;
  }

  private async searchAcrossProviders(
    query: string,
    maxResults: number,
    deprioritizeProvider?: WebSearchProvider,
  ): Promise<WebSearchContext> {
    const orderedEndpoints = deprioritizeProvider && deprioritizeProvider !== 'none'
      ? [
          ...SEARCH_ENDPOINTS.filter(endpoint => endpoint.provider !== deprioritizeProvider),
          ...SEARCH_ENDPOINTS.filter(endpoint => endpoint.provider === deprioritizeProvider),
        ]
      : [...SEARCH_ENDPOINTS];
    let lastError: unknown;

    for (const endpoint of orderedEndpoints) {
      try {
        const html = await fetchSearchHtml(endpoint, query, maxResults);
        const sources = endpoint.parser(html, maxResults);
        if (sources.length === 0) throw new Error('搜索服务没有返回可用结果。');
        return {
          query,
          provider: endpoint.provider,
          searchedAt: new Date().toISOString(),
          sources: reindexSources(sources, maxResults),
          pages: [],
          secondaryQueries: [],
          providers: [endpoint.provider],
          searchRounds: 1,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('联网搜索失败。');
  }

  private async readSources(
    sources: WebSearchSource[],
    query: string,
    maxPages: number,
  ): Promise<WebPageEvidence[]> {
    const selected: WebSearchSource[] = [];
    const deferred: WebSearchSource[] = [];
    const seenDomains = new Set<string>();
    for (const source of sources) {
      if (seenDomains.has(source.domain)) deferred.push(source);
      else {
        selected.push(source);
        seenDomains.add(source.domain);
      }
    }
    selected.push(...deferred);

    const settled = await Promise.allSettled(
      selected.slice(0, Math.max(0, maxPages)).map(source => this.pageExtractor.read(source, query)),
    );
    return settled
      .filter((item): item is PromiseFulfilledResult<WebPageEvidence | null> => item.status === 'fulfilled')
      .map(item => item.value)
      .filter((page): page is WebPageEvidence => page !== null);
  }
}

export function shouldAutoSearch(message: string, detectedActionType?: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (detectedActionType === 'news' || detectedActionType === 'weather') return true;

  const freshness = /(?:最新|刚刚|刚才发生|今天|今日|现在|目前|当前|近期|最近|本周|这周|本月|这个月|今年|实时|现任|截至|截止|新闻|热点|热搜|快讯|股价|股票价格|汇率|比分|赛程|天气|气温|票房|排行榜|排名|版本更新|新发布|刚发布|价格|多少钱|营业时间|开门吗)/i;
  const unstableRole = /(?:现任|现在的|当前的)?\s*(?:总统|主席|总理|首相|CEO|首席执行官|负责人|冠军|世界第一|市长|州长|省长|部长|导演|主演)(?:是谁|是哪个|叫什么)?/i;
  const english = /\b(?:search the web|web search|look it up|latest|breaking news|today|current|currently|real[- ]?time|weather|score|stock price|exchange rate)\b/i;
  const url = /https?:\/\/[^\s]+/i;

  return isExplicitSearchRequest(text)
    || freshness.test(text)
    || unstableRole.test(text)
    || english.test(text)
    || url.test(text);
}

export function isExplicitSearchRequest(message: string): boolean {
  return /(?:联网|上网|网上|网页|网络)(?:搜|查|找|检索)|(?:搜索|搜一下|搜一搜|帮我搜|替我搜|查一下|查一查|帮我查|替我查|查证|核实)(?:\s|：|:|一下|一下子|关于|有关|看看|下|个|一)?/i.test(message);
}

export function extractSearchQuery(message: string): string {
  return cleanQuery(message)
    .replace(/^(?:请|麻烦)?\s*(?:你)?\s*(?:帮我|替我|给我)?\s*(?:联网|上网|网上|网页|网络)?\s*(?:搜索|搜一搜|搜一下|搜|查询|查一查|查一下|查|检索|核实|查证)\s*(?:一下|看看)?\s*[：:]?\s*/i, '')
    .replace(/[。！？!?]+$/g, '')
    .trim() || cleanQuery(message);
}

export function parseDuckDuckGoHtml(html: string, maxResults = 5): WebSearchSource[] {
  const anchorPattern = /<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*(?:result__a|result-link)[^"']*["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorPattern));
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length && sources.length < clamp(maxResults, 1, 8); index += 1) {
    const match = matches[index];
    const title = cleanText(match[2], 220);
    const url = normalizeResultUrl(decodeHtmlEntities(match[1]));
    if (!title || !url || seen.has(url)) continue;

    const segmentEnd = matches[index + 1]?.index ?? Math.min(html.length, (match.index ?? 0) + 7_000);
    const segment = html.slice((match.index ?? 0) + match[0].length, segmentEnd);
    const snippetMatch = segment.match(/<(?:a|div|td)\b[^>]*\bclass\s*=\s*["'][^"']*(?:result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/i);
    const snippet = cleanText(snippetMatch?.[1] ?? '', 520);

    seen.add(url);
    sources.push({
      id: sources.length + 1,
      title,
      url,
      domain: displayDomain(url),
      snippet,
    });
  }

  return sources;
}

export function parseSogouMobileHtml(html: string, maxResults = 5): WebSearchSource[] {
  if (/antispider|_____tmd_____|captcha/i.test(html)) return [];

  const anchorPattern = /<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*resultLink[^"']*["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorPattern));
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length && sources.length < clamp(maxResults, 1, 8); index += 1) {
    const match = matches[index];
    const title = cleanText(match[2], 220);
    const url = normalizeSogouResultUrl(decodeHtmlEntities(match[1]));
    if (!title || !url || seen.has(url)) continue;

    const segmentEnd = matches[index + 1]?.index ?? Math.min(html.length, (match.index ?? 0) + 9_000);
    const segment = html.slice((match.index ?? 0) + match[0].length, segmentEnd);
    const snippetMatch = segment.match(/<(?:div|p)\b[^>]*\bclass\s*=\s*["'][^"']*(?:clamp2|txt-summary|fz-mid)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i);
    const snippet = cleanText(snippetMatch?.[1] ?? '', 520);

    seen.add(url);
    sources.push({
      id: sources.length + 1,
      title,
      url,
      domain: displayDomain(url),
      snippet,
    });
  }

  return sources;
}

export function parseBingHtml(html: string, maxResults = 5): WebSearchSource[] {
  const blockPattern = /<li\b[^>]*\bclass\s*=\s*["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const blocks = Array.from(html.matchAll(blockPattern));
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();

  for (const blockMatch of blocks) {
    if (sources.length >= clamp(maxResults, 1, 8)) break;
    const block = blockMatch[1];
    const header = block.match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*b_algoheader[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
    const href = header.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] ?? '';
    const titleHtml = header.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '';
    const title = cleanText(titleHtml, 220);
    const url = normalizeDirectResultUrl(decodeHtmlEntities(href), 'https://cn.bing.com');
    if (!title || !url || seen.has(url)) continue;

    const snippetHtml = block.match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*b_caption[^"']*["'][^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
    seen.add(url);
    sources.push({
      id: sources.length + 1,
      title,
      url,
      domain: displayDomain(url),
      snippet: cleanText(snippetHtml, 520),
    });
  }

  return sources;
}

async function fetchSearchHtml(endpoint: SearchEndpoint, query: string, maxResults: number): Promise<string> {
  const url = new URL(endpoint.url);
  url.searchParams.set(endpoint.queryParam, query);
  if (endpoint.provider === 'bing') {
    url.searchParams.set('count', String(maxResults));
    url.searchParams.set('mkt', 'zh-CN');
  }
  if (endpoint.provider === 'duckduckgo') url.searchParams.set('kl', 'cn-zh');

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      'User-Agent': endpoint.mobile
        ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36 Athena/1.0'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Athena/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(endpoint.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`搜索服务返回 ${response.status}。`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SEARCH_HTML_BYTES) {
    throw new Error('搜索结果页面过大。');
  }

  const html = await response.text();
  if (html.length > MAX_SEARCH_HTML_BYTES) throw new Error('搜索结果页面过大。');
  return html;
}

function normalizeSogouResultUrl(rawHref: string): string | null {
  try {
    const parsed = new URL(rawHref, 'https://m.sogou.com/web/searchList.jsp');
    const redirectTarget = parsed.searchParams.get('url') || parsed.searchParams.get('pcurl');
    if (!redirectTarget) return null;
    return normalizeDirectResultUrl(redirectTarget, parsed.origin);
  } catch {
    return null;
  }
}

function normalizeDirectResultUrl(rawHref: string, baseUrl: string): string | null {
  try {
    const target = new URL(rawHref, baseUrl);
    if (!isPublicHttpUrl(target)) return null;
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

function normalizeResultUrl(rawHref: string): string | null {
  try {
    const absolute = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const parsed = new URL(absolute, 'https://duckduckgo.com');
    const redirectTarget = parsed.hostname.endsWith('duckduckgo.com')
      ? parsed.searchParams.get('uddg')
      : null;
    const target = new URL(redirectTarget || parsed.toString());
    if (!isPublicHttpUrl(target)) return null;
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

function isPublicHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
  if (/^(?:0|10|127|169\.254|192\.168)\./.test(host)) return false;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  return true;
}

function displayDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function cleanText(value: string, maxLength: number): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const hexadecimal = code[1]?.toLowerCase() === 'x';
    const parsed = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
  });
}

export function buildSecondarySearchQuery(
  query: string,
  sources: WebSearchSource[],
  pages: WebPageEvidence[],
  now = new Date(),
): string {
  const base = cleanQuery(query).replace(/[。！？!?]+$/g, '');
  const hasChinese = /[\u3400-\u9fff]/.test(base);
  const isComparison = /(?:对比|比较|区别|差异|哪个好|\bvs\.?\b|versus)/i.test(base);
  const isTimeSensitive = /(?:最新|今天|今日|现在|目前|当前|近期|最近|实时|新闻|价格|天气|latest|today|current|news|price|weather)/i.test(base);
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const evidenceHint = pages.length === 0 || sources.length < 2
    ? (hasChinese ? '详细资料' : 'detailed evidence')
    : (hasChinese ? '事实核验' : 'fact check');

  if (hasChinese) {
    if (isComparison) return cleanQuery(`${base} 详细对比 数据 来源 ${now.getFullYear()}`);
    if (isTimeSensitive) return cleanQuery(`${base} 官方 最新进展 ${date}`);
    return cleanQuery(`${base} 官方 原始资料 ${evidenceHint}`);
  }
  if (isComparison) return cleanQuery(`${base} detailed comparison data sources ${now.getFullYear()}`);
  if (isTimeSensitive) return cleanQuery(`${base} official latest update ${date}`);
  return cleanQuery(`${base} official primary source ${evidenceHint}`);
}

function mergeSources(
  primary: WebSearchSource[],
  secondary: WebSearchSource[],
  maxResults: number,
): WebSearchSource[] {
  const merged: WebSearchSource[] = [];
  const seen = new Set<string>();
  for (const source of [...primary, ...secondary]) {
    const key = canonicalUrlKey(source.url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...source, id: merged.length + 1 });
    if (merged.length >= maxResults) break;
  }
  return merged;
}

function reindexSources(sources: WebSearchSource[], maxResults: number): WebSearchSource[] {
  return sources.slice(0, Math.max(1, maxResults)).map((source, index) => ({
    ...source,
    id: index + 1,
  }));
}

function canonicalUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:utm_|spm$|from$|ref$|source$|campaign$|tracking)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
