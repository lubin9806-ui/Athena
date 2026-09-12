import { createLogger } from '../../engine/Logger';
import type { SearchApiProvider, SearchRecency, WebSearchSource } from '../../shared/types';

const logger = createLogger('SearchApiClient');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Measured 2026-09-11 with a real key: search_std and search_pro answer with every
// link empty, so nothing they return can be cited or opened. Quark is the documented
// engine that carries links and publish dates and honours the recency filter.
const SEARCH_ENGINE = 'search_pro_quark';

/**
 * Failure shape the HTML pipeline already knows how to classify. Carrying the code on
 * the error keeps the contracted API inside the same rate-limit, cooldown and
 * degradation handling as the scraped providers instead of a second scheme.
 */
export interface SearchApiFailure extends Error {
  searchFailureCode: 'timeout' | 'rate_limited' | 'access_denied' | 'network' | 'invalid_response' | 'no_results';
  retryAfterMs?: number;
}

export interface SearchApiCredentials {
  provider: SearchApiProvider;
  apiKey: string;
}

/**
 * Zhipu BigModel web search. Request and response shapes follow the published
 * reference: POST /api/paas/v4/web_search with `search_query`, answering with a
 * `search_result` array of { title, content, link, media, icon, refer, publish_date }.
 */
export class SearchApiClient {
  constructor(private readonly resolveCredentials: () => SearchApiCredentials | null) {}

  isConfigured(): boolean {
    return this.resolveCredentials() !== null;
  }

  configuredProvider(): SearchApiProvider | null {
    return this.resolveCredentials()?.provider ?? null;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal, recency: SearchRecency = 'noLimit'): Promise<WebSearchSource[]> {
    const credentials = this.resolveCredentials();
    if (!credentials) throw failure('access_denied', '没有配置搜索 API 凭据。');

    const response = await this.post(credentials, query, maxResults, recency, signal);
    const sources = parseZhipuResults(response, maxResults);
    if (sources.length === 0) throw failure('no_results', '搜索 API 没有返回可用结果。');
    return sources;
  }

  private async post(
    credentials: SearchApiCredentials,
    query: string,
    maxResults: number,
    recency: SearchRecency,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch('https://open.bigmodel.cn/api/paas/v4/web_search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          search_query: query,
          search_engine: SEARCH_ENGINE,
          search_intent: false,
          count: maxResults,
          search_recency_filter: recency,
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|timed out|aborted/i.test(message)) throw failure('timeout', '搜索 API 响应超时。');
      throw failure('network', '无法连接搜索 API，请检查网络。');
    }

    if (!response.ok) throw classifyHttpFailure(response.status, response.headers.get('retry-after'));

    const body = await readBoundedText(response, MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(body);
    } catch {
      throw failure('invalid_response', '搜索 API 返回了无法解析的响应。');
    }
  }
}

/**
 * Defensive on purpose: a renamed field must fail loudly in the log rather than
 * silently return zero results the way the scraped Bing parser once did.
 */
export function parseZhipuResults(payload: unknown, maxResults: number): WebSearchSource[] {
  if (!isRecord(payload)) return [];
  const results = payload.search_result;
  if (!Array.isArray(results)) {
    logger.warn(`Search API response had no search_result array; keys=${Object.keys(payload).join(',') || 'none'}`);
    return [];
  }

  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (sources.length >= clamp(maxResults, 1, 8)) break;
    if (!isRecord(item)) continue;
    const url = readText(item.link, 2_000);
    const title = readText(item.title, 220);
    if (!url || !title || !isPublicHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const publishedAt = readText(item.publish_date, 40);
    sources.push({
      id: sources.length + 1,
      title,
      url,
      domain: displayDomain(url),
      snippet: readText(item.content, 520),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }

  if (sources.length === 0 && results.length > 0) {
    const withoutLink = results.filter(item => isRecord(item) && !readText(item.link, 2_000)).length;
    logger.warn(`Search API returned ${results.length} result(s) but none were usable (${withoutLink} without a link); first keys=${Object.keys(isRecord(results[0]) ? results[0] : {}).join(',')}`);
  }
  return sources;
}

function classifyHttpFailure(status: number, retryAfter: string | null): SearchApiFailure {
  if (status === 429) return failure('rate_limited', '搜索 API 正在限流，请稍后再试。', parseRetryAfter(retryAfter) || 60_000);
  if (status === 401 || status === 403) return failure('access_denied', '搜索 API 拒绝了凭据，请检查 API Key 是否有效。');
  return failure('invalid_response', `搜索 API 暂时异常（HTTP ${status}）。`);
}

function failure(code: SearchApiFailure['searchFailureCode'], message: string, retryAfterMs = 0): SearchApiFailure {
  return Object.assign(new Error(message), { searchFailureCode: code, retryAfterMs, name: 'SearchApiFailure' });
}

export function isSearchApiFailure(error: unknown): error is SearchApiFailure {
  return error instanceof Error && typeof (error as SearchApiFailure).searchFailureCode === 'string';
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
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
      throw failure('invalid_response', '搜索 API 响应过大。');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    if (/^(?:0|10|127|169\.254|192\.168)\./.test(host)) return false;
    const private172 = host.match(/^172\.(\d{1,3})\./);
    return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
  } catch {
    return false;
  }
}

function displayDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
