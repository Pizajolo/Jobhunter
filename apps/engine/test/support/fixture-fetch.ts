import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './helpers.js';

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'http/manifest.json'), 'utf8')) as Record<string, string>;

/** A `fetch` that serves recorded fixtures; robots.txt is 404 (allowed) unless overridden. */
export function fixtureFetch(extra: Record<string, { status: number; body: string; headers?: Record<string, string> }> = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const key = `${method} ${url}`;
    if (extra[key] ?? extra[url]) {
      const e = (extra[key] ?? extra[url])!;
      return new Response(e.body, { status: e.status, headers: e.headers });
    }
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const file = manifest[key];
    if (!file) return new Response('not found', { status: 404 });
    return new Response(readFileSync(join(FIXTURES, 'http', file), 'utf8'), { status: 200, headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/html' } });
  }) as typeof fetch;
  return { impl, calls };
}
