import type {
  WebSearchContext,
  WebPageEvidence,
  WebSearchProvider,
  WebSearchSettings,
  WebSearchSource,
  WebSearchStatus,
} from '../../shared/types';
import { assertPublicUrl, PageContentExtractor } from './PageContentExtractor';

type ActiveSearchProvider = Exclude<WebSearchProvider, 'none'>;

interface SearchEndpoint {
  provider: ActiveSearchProvider;
  url: string;
  queryParam: 'q' | 'keyword';
  timeoutMs: number;
  parser: (html: string, maxResults: number) => WebSearchSource[];
  mobile?: boolean;
}

export type SearchFailureCode = 'timeout' | 'rate_limited' | 'anti_bot' | 'access_denied' | 'network' | 'invalid_response' | 'no_results';

export interface SearchProviderDiagnostics {
  attempts: number;
  successes: number;
  failures: Partial<Record<SearchFailureCode, number>>;
  lastFailureAt?: string;
}

export const SEARCH_PROVIDER_POLICY = {
  sogou: { commercialApproved: false, sla: false, termsUrl: 'https://www.sogou.com/docs/user.htm?v=1' },
  bing: { commercialApproved: false, sla: false, termsUrl: 'https://www.microsoft.com/en-us/servicesagreement' },
  duckduckgo: { commercialApproved: false, sla: false, termsUrl: 'https://duckduckgo.com/terms' },
} as const;

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
const MAX_SEARCH_REDIRECTS = 3;
const MAX_QUERY_CHARS = 500;
const PROVIDER_MIN_INTERVAL_MS = 1_250;
const PROVIDER_MAX_REQUESTS_PER_MINUTE = 8;

class SearchProviderError extends Error {
  constructor(readonly code: SearchFailureCode, message: string, readonly retryAfterMs = 0) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export class ProviderRequestGovernor {
  private readonly requestedAt = new Map<ActiveSearchProvider, number[]>();
  private readonly nextAllowedAt = new Map<ActiveSearchProvider, number>();

  async acquire(provider: ActiveSearchProvider, now = Date.now(), signal?: AbortSignal): Promise<void> {
    const recent = (this.requestedAt.get(provider) || []).filter(value => now - value < 60_000);
    if (recent.length >= PROVIDER_MAX_REQUESTS_PER_MINUTE) {
      throw new SearchProviderError('rate_limited', '搜索请求过于频繁，请稍后再试。', 60_000 - (now - recent[0]));
    }
    const delay = Math.max(0, (this.nextAllowedAt.get(provider) || 0) - now);
    if (delay > 0) await abortableDelay(delay, signal);
    const acquiredAt = Date.now();
    recent.push(acquiredAt);
    this.requestedAt.set(provider, recent);
    this.nextAllowedAt.set(provider, acquiredAt + PROVIDER_MIN_INTERVAL_MS);
  }

  cooldown(provider: ActiveSearchProvider, retryAfterMs: number): void {
    this.nextAllowedAt.set(provider, Math.max(this.nextAllowedAt.get(provider) || 0, Date.now() + retryAfterMs));
  }
}

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
  private readonly diagnostics = new Map<ActiveSearchProvider, SearchProviderDiagnostics>();

  constructor(
    private readonly pageExtractor = new PageContentExtractor(),
    private readonly governor = new ProviderRequestGovernor(),
  ) {}

  getDiagnostics(): Record<ActiveSearchProvider, SearchProviderDiagnostics> {
    return Object.fromEntries((['sogou', 'bing', 'duckduckgo'] as ActiveSearchProvider[]).map(provider => [
      provider,
      this.diagnostics.get(provider) || { attempts: 0, successes: 0, failures: {} },
    ])) as Record<ActiveSearchProvider, SearchProviderDiagnostics>;
  }

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
    signal?: AbortSignal,
  ): Promise<WebSearchContext> {
    const cleanedQuery = cleanQuery(query);
    if (!cleanedQuery) throw new Error('搜索词为空。');

    onStatus?.({ phase: 'searching', query: cleanedQuery });
    try {
      const context = await this.searchAcrossProviders(cleanedQuery, clamp(maxResults, 3, 8), undefined, signal);
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
    signal?: AbortSignal,
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
      initial = await this.searchAcrossProviders(cleanedQuery, initialLimit, undefined, signal);
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
      pages = await this.readSources(sources, cleanedQuery, firstReadLimit, signal);
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
        const secondary = await this.searchAcrossProviders(secondaryQuery, remainingResults, initial.provider, signal);
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
            pages.push(...await this.readSources(newSources, secondaryQuery, remainingPages, signal));
          }
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
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
    signal?: AbortSignal,
  ): Promise<WebSearchContext> {
    const orderedEndpoints = deprioritizeProvider && deprioritizeProvider !== 'none'
      ? [
          ...SEARCH_ENDPOINTS.filter(endpoint => endpoint.provider !== deprioritizeProvider),
          ...SEARCH_ENDPOINTS.filter(endpoint => endpoint.provider === deprioritizeProvider),
        ]
      : [...SEARCH_ENDPOINTS];
    let lastError: unknown;
    const failures: SearchProviderError[] = [];

    for (const endpoint of orderedEndpoints) {
      this.recordAttempt(endpoint.provider);
      try {
        throwIfAborted(signal);
        await this.governor.acquire(endpoint.provider, Date.now(), signal);
        const html = await fetchSearchHtml(endpoint, query, maxResults, signal);
        detectSearchFailurePage(html);
        const sources = endpoint.parser(html, maxResults);
        if (sources.length === 0) throw new SearchProviderError('no_results', '搜索服务没有返回可用结果。');
        this.recordSuccess(endpoint.provider);
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
        if (signal?.aborted) throw signal.reason || new Error('Web research cancelled');
        const classified = classifySearchError(error);
        if (classified.retryAfterMs > 0) this.governor.cooldown(endpoint.provider, classified.retryAfterMs);
        this.recordFailure(endpoint.provider, classified.code);
        failures.push(classified);
        lastError = classified;
      }
    }

    throw failures.length > 0 ? summarizeProviderFailures(failures) : lastError instanceof Error ? lastError : new Error('联网搜索失败。');
  }

  private async readSources(
    sources: WebSearchSource[],
    query: string,
    maxPages: number,
    signal?: AbortSignal,
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

    const limited = selected.slice(0, Math.max(0, maxPages));
    const settled: PromiseSettledResult<WebPageEvidence | null>[] = [];
    for (let index = 0; index < limited.length; index += 2) {
      throwIfAborted(signal);
      settled.push(...await Promise.allSettled(limited.slice(index, index + 2).map(source => this.pageExtractor.read(source, query, signal))));
    }
    throwIfAborted(signal);
    return settled
      .filter((item): item is PromiseFulfilledResult<WebPageEvidence | null> => item.status === 'fulfilled')
      .map(item => item.value)
      .filter((page): page is WebPageEvidence => page !== null);
  }

  private recordAttempt(provider: ActiveSearchProvider): void {
    const item = this.diagnostics.get(provider) || { attempts: 0, successes: 0, failures: {} };
    item.attempts += 1;
    this.diagnostics.set(provider, item);
  }

  private recordSuccess(provider: ActiveSearchProvider): void {
    const item = this.diagnostics.get(provider)!;
    item.successes += 1;
  }

  private recordFailure(provider: ActiveSearchProvider, code: SearchFailureCode): void {
    const item = this.diagnostics.get(provider)!;
    item.failures[code] = (item.failures[code] || 0) + 1;
    item.lastFailureAt = new Date().toISOString();
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

async function fetchSearchHtml(endpoint: SearchEndpoint, query: string, maxResults: number, signal?: AbortSignal): Promise<string> {
  const url = new URL(endpoint.url);
  url.searchParams.set(endpoint.queryParam, query);
  if (endpoint.provider === 'bing') {
    url.searchParams.set('count', String(maxResults));
    url.searchParams.set('mkt', 'zh-CN');
  }
  if (endpoint.provider === 'duckduckgo') url.searchParams.set('kl', 'cn-zh');

  const deadline = Date.now() + endpoint.timeoutMs;
  let currentUrl = url;
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= MAX_SEARCH_REDIRECTS; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 250) throw new SearchProviderError('timeout', '搜索服务响应超时，已自动尝试其他来源。');
    response = await fetch(currentUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'User-Agent': endpoint.mobile
          ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36 Athena/1.0'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Athena/1.0',
      },
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]) : AbortSignal.timeout(remainingMs),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirectCount === MAX_SEARCH_REDIRECTS) throw new Error('搜索服务重定向过多。');
    currentUrl = new URL(location, currentUrl);
    await assertPublicUrl(currentUrl);
  }
  if (!response) throw new Error('搜索服务没有返回响应。');

  if (!response.ok) {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    if (response.status === 429) throw new SearchProviderError('rate_limited', '搜索服务正在限流，请稍后再试。', retryAfter || 60_000);
    if (response.status === 401 || response.status === 403) throw new SearchProviderError('access_denied', '搜索服务拒绝了请求，已尝试其他来源。');
    throw new SearchProviderError('invalid_response', `搜索服务暂时异常（HTTP ${response.status}）。`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SEARCH_HTML_BYTES) {
    throw new Error('搜索结果页面过大。');
  }

  return readBoundedSearchHtml(response, MAX_SEARCH_HTML_BYTES);
}

async function readBoundedSearchHtml(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('搜索结果页面过大。');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function detectSearchFailurePage(html: string): void {
  const sample = html.slice(0, 200_000);
  if (/antispider|_____tmd_____|captcha|verify\s*(?:you are|that you are)|unusual traffic|安全验证|请输入验证码|访问过于频繁|人机验证/i.test(sample)) {
    throw new SearchProviderError('anti_bot', '搜索服务触发了反爬验证，已自动尝试其他来源。');
  }
  if (/<title>\s*(?:access denied|forbidden|service unavailable)/i.test(sample)) {
    throw new SearchProviderError('access_denied', '搜索服务拒绝访问，已自动尝试其他来源。');
  }
}

function classifySearchError(error: unknown): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) return new SearchProviderError('timeout', '搜索服务响应超时，已自动尝试其他来源。');
  if (/fetch failed|network|ENOTFOUND|ECONN|socket/i.test(message)) return new SearchProviderError('network', '当前网络不可用或连接不稳定，请检查网络后重试。');
  return new SearchProviderError('invalid_response', '搜索服务返回了无法识别的响应。');
}

function summarizeProviderFailures(failures: SearchProviderError[]): Error {
  const codes = new Set(failures.map(item => item.code));
  if (codes.has('network') || codes.has('timeout')) return new Error('联网搜索未完成：当前网络不可用或过慢。你仍可继续本地对话，稍后再点“联网搜索”重试。');
  if (codes.has('rate_limited')) return new Error('联网搜索请求过于频繁，服务正在限流。请稍后重试；本地对话不受影响。');
  if (codes.has('anti_bot') || codes.has('access_denied')) return new Error('联网搜索被第三方服务的验证或访问策略阻止。Athena 没有绕过验证；你可以稍后重试或关闭联网搜索。');
  return new Error('联网搜索暂时没有可用结果。你仍可继续本地对话，或换一个更具体的搜索词。');
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason || new Error('Web research cancelled');
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Web research cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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
