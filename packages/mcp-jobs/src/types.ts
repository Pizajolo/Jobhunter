import type { AtsType, RawJob, RawJobInput } from '@jobhunter/shared';

/** HTTP access for adapters. The engine's implementation is polite: robots.txt, rate limits, cache. */
export interface Fetcher {
  text(url: string, init?: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }): Promise<FetchResult>;
  json<T = unknown>(url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T>;
}

export interface FetchResult {
  status: number;
  body: string;
  contentType: string | null;
  url: string;
  fromCache: boolean;
  contentHash: string;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: 'http' | 'robots' | 'budget' | 'network' | 'parse',
  ) {
    super(message);
  }
}

/** Extracts postings from an arbitrary careers page with a (small) model. */
export interface PageExtractor {
  extract(page: { url: string; text: string; links: { text: string; href: string }[] }): Promise<{
    jobs: { title: string; location: string | null; url: string | null; description: string | null }[];
    nextPageUrl: string | null;
  }>;
}

export interface SourceContext {
  fetch: Fetcher;
  extractor?: PageExtractor;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
  /** Stop early (e.g. scan cancelled). */
  signal?: AbortSignal;
}

export interface SourceConfig {
  /** Adapter id, e.g. "greenhouse". */
  kind: AtsType | string;
  /** Company display name (for ATS adapters). */
  company?: string;
  /** ATS slug / tenant. */
  slug?: string;
  /** Any URL the adapter needs (careers page, feed, Workday site). */
  url?: string;
  /** Free-form adapter options. */
  options?: Record<string, unknown>;
}

/** Every job source implements this (spec §5.3). */
export interface JobSource {
  readonly kind: string;
  list(config: SourceConfig, ctx: SourceContext): Promise<RawJobInput[]>;
  get?(id: string, config: SourceConfig, ctx: SourceContext): Promise<RawJobInput | null>;
}

export type { RawJob, RawJobInput };
