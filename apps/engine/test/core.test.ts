import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestContext } from '../src/context.js';
import { buildApp } from '../src/server/app.js';
import { EncryptedFileSecretStore } from '../src/secrets/index.js';
import { scrubSecrets } from '../src/logger.js';
import { loadConfig } from '../src/config.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'jh-'));
  dirs.push(d);
  return d;
}

describe('engine core', () => {
  it('serves health and settings', async () => {
    const ctx = createTestContext();
    const app = await buildApp(ctx);
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ ok: true, version: '0.1.0' });
    const patched = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { language: 'pt' } });
    expect(patched.json().language).toBe('pt');
    const bad = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { language: 'xx' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('round-trips secrets in the encrypted file and never stores plaintext', async () => {
    const dir = tmp();
    const store = new EncryptedFileSecretStore(join(dir, 'secrets.enc'), 'a-long-master-key-for-tests');
    await store.set('anthropic_api_key', 'sk-ant-supersecretvalue123');
    expect(await store.get('anthropic_api_key')).toBe('sk-ant-supersecretvalue123');
    expect(readFileSync(join(dir, 'secrets.enc'), 'utf8')).not.toContain('supersecret');
    const wrong = new EncryptedFileSecretStore(join(dir, 'secrets.enc'), 'another-long-master-key');
    await expect(wrong.get('anthropic_api_key')).rejects.toThrow();
    await store.delete('anthropic_api_key');
    expect(await store.has('anthropic_api_key')).toBe(false);
  });

  it('scrubs secrets from text', () => {
    expect(scrubSecrets('key=sk-ant-api03-abcdefghijklmnop and Bearer abcdefghijklmnop')).toBe('key=[REDACTED] and [REDACTED]');
    expect(scrubSecrets('app password abcd efgh ijkl mnop')).toBe('app password [REDACTED]');
  });

  it('defaults to localhost and the file secrets backend in server mode', () => {
    const dir = tmp();
    const c = loadConfig({ JOBHUNTER_MODE: 'server', JOBHUNTER_DATA_DIR: dir });
    expect(c.host).toBe('127.0.0.1');
    expect(c.secretsBackend).toBe('file');
    expect(c.requireLogin).toBe(true);
    expect(c.headlessBrowser).toBe(true);
  });
});
