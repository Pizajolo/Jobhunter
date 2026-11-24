import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';
import { USER_AGENT } from '@jobhunter/shared';
import { domainBudget, eq, httpCache, sql, type Db } from '@jobhunter/db';
import { FetchError, type Fetcher, type FetchResult } from '@jobhunter/mcp-jobs';

export interface PoliteFetcherOptions {
  minIntervalMs: number;
  maxPagesPerDomainPerDay: number;
  /** Serve cached GET responses younger than this without touching the network. */
  freshMs: number;
  timeoutMs?: number;
  /** For tests: replaces global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Polite HTTP client for scanning (spec §2.6): honest user agent, robots.txt, at most one request
 * per domain every `minIntervalMs`, a daily page cap per domain, conditional requests and a cache.
 */
export class PoliteFetcher implements Fetcher {
  private readonly nextSlot = new Map<string, number>();
  private readonly robots = new Map<string, Promise<ReturnType<typeof robotsParser> | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly opts: PoliteFetcherOptions,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Wait for this domain's next free slot (requests to one domain are serialised). */
  private async throttle(host: string): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.opts.minIntervalMs);
    if (slot > now) await this.sleep(slot - now);
  }

  private takeBudget(host: string): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const row = this.db
      .insert(domainBudget)
      .values({ domain: host, day, count: 1 })
      .onConflictDoUpdate({ target: [domainBudget.domain, domainBudget.day], set: { count: sql`${domainBudget.count} + 1` } })
      .returning({ count: domainBudget.count })
      .get();
    if (row.count > this.opts.maxPagesPerDomainPerDay) {
      throw new FetchError(`Daily limit of ${this.opts.maxPagesPerDomainPerDay} pages reached for ${host}`, null, 'budget');
    }
  }

  private async allowedByRobots(url: URL): Promise<boolean> {
    const key = url.origin;
    let p = this.robots.get(key);
    if (!p) {
      p = (async () => {
        const robotsUrl = `${url.origin}/robots.txt`;
        try {
          const cached = this.db.select().from(httpCache).where(eq(httpCache.url, robotsUrl)).get();
          if (cached && this.now() - Date.parse(cached.fetchedAt) < 24 * 3600_000) return robotsParser(robotsUrl, cached.body);
          await this.throttle(url.host);
          const res = await this.fetchImpl(robotsUrl, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000) });
          const body = res.ok ? await res.text() : '';
          this.store(robotsUrl, res.status, body, null, null, res.headers.get('content-type'));
          return robotsParser(robotsUrl, body);
        } catch {
          return null; // unreachable robots.txt: treat as allowed
        }
      })();
      this.robots.set(key, p);
    }
    const robots = await p;
    return robots ? robots.isAllowed(url.toString(), USER_AGENT) !== false : true;
  }

  private store(url: string, status: number, body: string, etag: string | null, lastModified: string | null, contentType: string | null) {
    const values = { url, status, body, etag, lastModified, contentType, contentHash: sha(body), fetchedAt: new Date(this.now()).toISOString() };
    this.db.insert(httpCache).values(values).onConflictDoUpdate({ target: httpCache.url, set: values }).run();
  }

  async text(url: string, init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {}): Promise<FetchResult> {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError(`Unsupported URL ${url}`, null, 'network');
    const method = init.method ?? 'GET';
    const cacheKey = method === 'GET' ? url : `${method} ${url} ${sha(init.body ?? '')}`;
    const cached = this.db.select().from(httpCache).where(eq(httpCache.url, cacheKey)).get();
    if (cached && cached.status < 400 && this.now() - Date.parse(cached.fetchedAt) < this.opts.freshMs) {
      return { status: cached.status, body: cached.body, contentType: cached.contentType, url, fromCache: true, contentHash: cached.contentHash };
    }
    if (!(await this.allowedByRobots(u))) throw new FetchError(`robots.txt disallows ${url}`, null, 'robots');
    this.takeBudget(u.host);
    await this.throttle(u.host);
    const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...init.headers };
    if (method === 'GET' && cached?.etag) headers['if-none-match'] = cached.etag;
    if (method === 'GET' && cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
    if (init.body) headers['content-type'] = headers['content-type'] ?? 'application/json';
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body: init.body, redirect: 'follow', signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000) });
    } catch (err) {
      throw new FetchError(`Network error for ${url}: ${(err as Error).message}`, null, 'network');
    }
    if (res.status === 304 && cached) {
      this.store(cacheKey, cached.status, cached.body, cached.etag, cached.lastModified, cached.contentType);
      return { status: cached.status, body: cached.body, contentType: cached.contentType, url, fromCache: true, contentHash: cached.contentHash };
    }
    const body = await res.text();
    if (!res.ok) throw new FetchError(`HTTP ${res.status} for ${url}`, res.status, 'http');
    this.store(cacheKey, res.status, body, res.headers.get('etag'), res.headers.get('last-modified'), res.headers.get('content-type'));
    return { status: res.status, body, contentType: res.headers.get('content-type'), url: res.url || url, fromCache: false, contentHash: sha(body) };
  }

  async json<T>(url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
    const r = await this.text(url, init ? { method: init.method, body: init.body === undefined ? undefined : JSON.stringify(init.body) } : {});
    try {
      return JSON.parse(r.body) as T;
    } catch {
      throw new FetchError(`Invalid JSON from ${url}`, r.status, 'parse');
    }
  }
}
