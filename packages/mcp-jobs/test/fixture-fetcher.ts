import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FetchError, type Fetcher, type FetchResult } from '../src/types.js';

const DIR = join(import.meta.dirname, '../../../fixtures/http');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, string>;

/** Serves recorded responses; any request not in the manifest fails the test (no live calls in CI). */
export class FixtureFetcher implements Fetcher {
  readonly requests: string[] = [];
  async text(url: string, init?: { method?: 'GET' | 'POST' }): Promise<FetchResult> {
    const key = `${init?.method ?? 'GET'} ${url}`;
    this.requests.push(key);
    const file = manifest[key];
    if (!file) throw new FetchError(`No fixture for ${key}`, 404, 'http');
    const body = readFileSync(join(DIR, file), 'utf8');
    return { status: 200, body, contentType: file.endsWith('.json') ? 'application/json' : 'text/html', url, fromCache: false, contentHash: createHash('sha256').update(body).digest('hex') };
  }
  async json<T>(url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
    const r = await this.text(url, init ? { method: init.method } : undefined);
    return JSON.parse(r.body) as T;
  }
}
