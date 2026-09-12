export type WebSearchMode = 'auto' | 'manual';
export type WebSearchPhase = 'searching' | 'reading' | 'refining' | 'done' | 'failed';
/** 'zhipu' is the contracted search API; the rest are the Internal Alpha HTML sources. */
export type WebSearchProvider = 'zhipu' | 'sogou' | 'bing' | 'duckduckgo' | 'none';
export type SearchApiProvider = 'zhipu';
/** How fresh results must be. Only the contracted API can filter on it; the scraped providers ignore it. */
export type SearchRecency = 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit';
export type WebPageExtractionMethod = 'json-ld' | 'article' | 'main' | 'semantic' | 'body' | 'text' | 'json';

export interface WebSearchSettings {
  enabled: boolean;
  mode: WebSearchMode;
  maxResults: number;
  deepRead: boolean;
  secondarySearch: boolean;
  maxPages: number;
}

export interface WebSearchSource {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  /** Provider-reported publish date, when the provider gives one. */
  publishedAt?: string;
}

export interface WebPageEvidence {
  sourceId: number;
  title: string;
  url: string;
  excerpt: string;
  charCount: number;
  extractionMethod: WebPageExtractionMethod;
  extractedAt: string;
  publishedAt?: string;
}

export interface WebSearchContext {
  query: string;
  provider: WebSearchProvider;
  searchedAt: string;
  sources: WebSearchSource[];
  pages?: WebPageEvidence[];
  secondaryQueries?: string[];
  providers?: WebSearchProvider[];
  searchRounds?: number;
  error?: string;
}

export interface WebSearchSummary {
  query: string;
  provider: WebSearchProvider;
  searchedAt: string;
  sources: WebSearchSource[];
  readPageCount: number;
  searchRounds: number;
  providers: WebSearchProvider[];
  error?: string;
}

export interface WebSearchStatus {
  phase: WebSearchPhase;
  query: string;
  resultCount?: number;
  pageCount?: number;
  searchRound?: number;
  provider?: WebSearchProvider;
  message?: string;
}
