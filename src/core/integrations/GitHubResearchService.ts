import { APP_VERSION } from '../../shared/constants';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_README_CHARS = 80_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const REPOSITORY_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;

export interface GitHubSearchInput {
  query: string;
  sort?: 'best-match' | 'stars' | 'updated';
  order?: 'asc' | 'desc';
  perPage?: number;
  page?: number;
  includeForks?: boolean;
}

export interface GitHubRateLimitEvidence {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  resource: string | null;
}

export interface GitHubRepositorySummary {
  fullName: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
}

export interface GitHubSearchEvidence {
  kind: 'github_repository_search';
  query: string;
  fetchedAt: string;
  apiVersion: string;
  sourceUrl: string;
  webSearchUrl: string;
  totalCount: number;
  incompleteResults: boolean;
  rateLimit: GitHubRateLimitEvidence;
  repositories: GitHubRepositorySummary[];
}

export interface GitHubRepositoryEvidence {
  kind: 'github_repository';
  fetchedAt: string;
  apiVersion: string;
  sourceUrl: string;
  rateLimit: GitHubRateLimitEvidence;
  repository: GitHubRepositorySummary & {
    homepage: string | null;
    visibility: string;
    sizeKb: number;
    subscribers: number;
  };
  readme: null | {
    name: string;
    path: string;
    htmlUrl: string | null;
    text: string;
    truncated: boolean;
  };
}

export interface GitHubResearchServiceOptions {
  fetcher?: typeof fetch;
  tokenEnvironmentVariable?: string;
  now?: () => number;
}

interface GitHubJsonResponse {
  data: unknown;
  sourceUrl: string;
  rateLimit: GitHubRateLimitEvidence;
  status: number;
}

export class GitHubResearchService {
  private readonly fetcher: typeof fetch;
  private readonly tokenEnvironmentVariable: string;
  private readonly now: () => number;
  private blockedUntil = 0;

  constructor(options: GitHubResearchServiceOptions = {}) {
    this.fetcher = options.fetcher || fetch;
    this.tokenEnvironmentVariable = options.tokenEnvironmentVariable || 'ATHENA_GITHUB_TOKEN';
    this.now = options.now || Date.now;
  }

  async searchRepositories(input: GitHubSearchInput, signal: AbortSignal): Promise<GitHubSearchEvidence> {
    const query = requireText(input.query, 'GitHub repository query', 256);
    const perPage = clampInteger(input.perPage, 1, 10, 6);
    const page = clampInteger(input.page, 1, 5, 1);
    const sort = input.sort === 'stars' || input.sort === 'updated' ? input.sort : 'best-match';
    const order = input.order === 'asc' ? 'asc' : 'desc';
    const qualifiedQuery = input.includeForks === true || /(?:^|\s)fork:/i.test(query) ? query : `${query} fork:false`;
    const params = new URLSearchParams({ q: qualifiedQuery, per_page: String(perPage), page: String(page) });
    if (sort !== 'best-match') {
      params.set('sort', sort);
      params.set('order', order);
    }
    const response = await this.requestJson(`/search/repositories?${params}`, signal);
    const body = requireRecord(response.data, 'GitHub search response');
    const repositories = Array.isArray(body.items)
      ? body.items.slice(0, perPage).map(normalizeRepository).filter((item): item is GitHubRepositorySummary => item !== null)
      : [];
    return {
      kind: 'github_repository_search',
      query,
      fetchedAt: new Date(this.now()).toISOString(),
      apiVersion: GITHUB_API_VERSION,
      sourceUrl: response.sourceUrl,
      webSearchUrl: `https://github.com/search?${new URLSearchParams({ q: qualifiedQuery, type: 'repositories' })}`,
      totalCount: nonNegativeInteger(body.total_count),
      incompleteResults: body.incomplete_results === true,
      rateLimit: response.rateLimit,
      repositories,
    };
  }

  async getRepository(ownerValue: string, repositoryValue: string, includeReadme: boolean, signal: AbortSignal): Promise<GitHubRepositoryEvidence> {
    const owner = requireRepositoryPart(ownerValue, 'GitHub owner');
    const repositoryName = requireRepositoryPart(repositoryValue, 'GitHub repository');
    const repositoryResponse = await this.requestJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`, signal);
    const repository = normalizeRepository(repositoryResponse.data);
    if (!repository) throw new Error('GitHub returned an invalid repository response');
    const body = requireRecord(repositoryResponse.data, 'GitHub repository response');
    let readme: GitHubRepositoryEvidence['readme'] = null;
    if (includeReadme) {
      const readmeResponse = await this.requestJson(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/readme`,
        signal,
        true,
      );
      if (readmeResponse.status === 200) readme = normalizeReadme(readmeResponse.data);
    }
    return {
      kind: 'github_repository',
      fetchedAt: new Date(this.now()).toISOString(),
      apiVersion: GITHUB_API_VERSION,
      sourceUrl: repositoryResponse.sourceUrl,
      rateLimit: repositoryResponse.rateLimit,
      repository: {
        ...repository,
        homepage: optionalHttpUrl(body.homepage),
        visibility: cleanText(body.visibility, 32) || (body.private === true ? 'private' : 'public'),
        sizeKb: nonNegativeInteger(body.size),
        subscribers: nonNegativeInteger(body.subscribers_count),
      },
      readme,
    };
  }

  private async requestJson(pathname: string, signal: AbortSignal, allowNotFound = false): Promise<GitHubJsonResponse> {
    if (!pathname.startsWith('/')) throw new Error('Invalid GitHub API path');
    if (this.blockedUntil > this.now()) {
      throw new Error(`GitHub API is rate limited until ${new Date(this.blockedUntil).toISOString()}`);
    }
    const url = new URL(pathname, GITHUB_API_BASE);
    if (url.origin !== GITHUB_API_BASE) throw new Error('GitHub API request escaped the approved origin');
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason || new Error('GitHub request cancelled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('GitHub request timed out')), REQUEST_TIMEOUT_MS);
    try {
      const token = process.env[this.tokenEnvironmentVariable]?.trim();
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': `Athena-Desktop/${APP_VERSION}`,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      let currentUrl = url;
      let response: Response | null = null;
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        response = await this.fetcher(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) throw new Error('GitHub API returned too many redirects');
        const redirected = new URL(location, currentUrl);
        if (redirected.origin !== GITHUB_API_BASE) throw new Error('GitHub API redirect escaped the approved origin');
        currentUrl = redirected;
      }
      if (!response) throw new Error('GitHub API returned no response');
      const rateLimit = readRateLimit(response.headers);
      this.updateRateLimit(response, rateLimit);
      if (allowNotFound && response.status === 404) {
        return { data: null, sourceUrl: currentUrl.toString(), rateLimit, status: response.status };
      }
      const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
      const parsed = parseJson(text);
      if (!response.ok) {
        const message = isRecord(parsed) ? cleanText(parsed.message, 500) : '';
        throw new Error(`GitHub API ${response.status}${message ? `: ${message}` : ''}`);
      }
      return { data: parsed, sourceUrl: currentUrl.toString(), rateLimit, status: response.status };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private updateRateLimit(response: Response, evidence: GitHubRateLimitEvidence): void {
    if (response.status !== 403 && response.status !== 429) return;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      this.blockedUntil = this.now() + Math.min(retryAfter * 1_000, 60 * 60_000);
    } else if (evidence.remaining === 0 && evidence.resetAt) {
      this.blockedUntil = Math.max(this.now(), Date.parse(evidence.resetAt));
    } else {
      this.blockedUntil = this.now() + 60_000;
    }
  }
}

function normalizeRepository(value: unknown): GitHubRepositorySummary | null {
  if (!isRecord(value)) return null;
  const fullName = cleanText(value.full_name, 220);
  const url = optionalHttpUrl(value.html_url);
  if (!fullName || !url) return null;
  const repositoryUrl = new URL(url);
  if (repositoryUrl.protocol !== 'https:' || repositoryUrl.hostname.toLowerCase() !== 'github.com') return null;
  const license = isRecord(value.license) ? cleanText(value.license.spdx_id, 80) : '';
  return {
    fullName,
    description: cleanText(value.description, 1_000),
    url,
    stars: nonNegativeInteger(value.stargazers_count),
    forks: nonNegativeInteger(value.forks_count),
    openIssues: nonNegativeInteger(value.open_issues_count),
    language: cleanText(value.language, 80) || null,
    topics: Array.isArray(value.topics) ? value.topics.map(item => cleanText(item, 80)).filter(Boolean).slice(0, 30) : [],
    license: license && license !== 'NOASSERTION' ? license : null,
    archived: value.archived === true,
    fork: value.fork === true,
    defaultBranch: cleanText(value.default_branch, 200),
    createdAt: optionalDate(value.created_at),
    updatedAt: optionalDate(value.updated_at),
    pushedAt: optionalDate(value.pushed_at),
  };
}

function normalizeReadme(value: unknown): GitHubRepositoryEvidence['readme'] {
  if (!isRecord(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  const bytes = Buffer.from(value.content.replace(/\s/g, ''), 'base64');
  const text = bytes.toString('utf8');
  return {
    name: cleanText(value.name, 220) || 'README',
    path: cleanText(value.path, 1_000) || 'README',
    htmlUrl: optionalGitHubUrl(value.html_url),
    text: text.slice(0, MAX_README_CHARS),
    truncated: text.length > MAX_README_CHARS,
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('GitHub API response exceeds the size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('GitHub API response exceeds the size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function readRateLimit(headers: Headers): GitHubRateLimitEvidence {
  const reset = Number(headers.get('x-ratelimit-reset'));
  return {
    limit: optionalInteger(headers.get('x-ratelimit-limit')),
    remaining: optionalInteger(headers.get('x-ratelimit-remaining')),
    resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1_000).toISOString() : null,
    resource: cleanText(headers.get('x-ratelimit-resource'), 80) || null,
  };
}

function requireRepositoryPart(value: unknown, label: string): string {
  const text = requireText(value, label, 100);
  if (!REPOSITORY_PART_PATTERN.test(text) || text === '.' || text === '..') throw new Error(`${label} is invalid`);
  return text;
}

function requireText(value: unknown, label: string, maxChars: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxChars) throw new Error(`${label} is required and must be at most ${maxChars} characters`);
  return text;
}

function cleanText(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.replace(/[\0\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxChars) : '';
}

function optionalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function optionalGitHubUrl(value: unknown): string | null {
  const url = optionalHttpUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'github.com' ? parsed.toString() : null;
}

function nonNegativeInteger(value: unknown): number {
  return optionalInteger(value) || 0;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error('GitHub API returned invalid JSON'); }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
