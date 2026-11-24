import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { unzipSync, strFromU8 } from 'fflate';
import { applications, getSettings, jobs, kvGet, kvSet, updateSettings } from '@jobhunter/db';
import { seedDemo } from '../src/dev/seed.js';
import { testApp } from './support/helpers.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'jh-data-'));
  const t = await testApp({ dataDir: dir, filesDir: join(dir, 'files'), browserProfileDir: join(dir, 'browser') });
  seedDemo(t.ctx);
  mkdirSync(join(dir, 'files', 'documents'), { recursive: true });
  writeFileSync(join(dir, 'files', 'documents', 'cv-1.pdf'), '%PDF-1.4 fake');
  mkdirSync(join(dir, 'browser', 'Default'), { recursive: true });
  writeFileSync(join(dir, 'browser', 'Default', 'Cookies'), 'portal session');
  await t.ctx.secrets.set('anthropic_api_key', 'sk-test-not-real');
  updateSettings(t.ctx.db, { language: 'de' });
  return { ...t, dir };
}

describe('your data', () => {
  it('exports the database, files and readable JSON, but no secrets or browser logins', async () => {
    const { app, ctx } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/data/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toMatch(/jobhunter-export-\d{4}-\d{2}-\d{2}\.zip/u);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'files/documents/cv-1.pdf', 'jobhunter.sqlite', 'profile.json', 'settings.json']);
    expect(JSON.parse(strFromU8(files['settings.json']!)).language).toBe('de');
    const db = new Database(Buffer.from(files['jobhunter.sqlite']!));
    const count = (db.prepare('SELECT count(*) AS n FROM applications').get() as { n: number }).n;
    expect(count).toBe(ctx.db.select().from(applications).all().length);
    db.close();
    const all = Object.values(files).map((f) => Buffer.from(f).toString('latin1')).join('\n');
    expect(all).not.toContain('sk-test-not-real');
    expect(all).not.toContain('portal session');
  });

  it('deletes everything only with the typed confirmation, and keeps the sign-in', async () => {
    const { app, ctx, dir } = await setup();
    kvSet(ctx.db, 'auth:passwordHash', 'hash');
    kvSet(ctx.db, 'gmail:historyId', '123');
    expect((await app.inject({ method: 'POST', url: '/api/data/delete-all', payload: { confirm: 'yes' } })).statusCode).toBe(400);
    expect(ctx.db.select().from(jobs).all().length).toBeGreaterThan(0);

    const res = await app.inject({ method: 'POST', url: '/api/data/delete-all', payload: { confirm: 'DELETE' } });
    expect(res.statusCode).toBe(200);
    expect(ctx.db.select().from(jobs).all()).toHaveLength(0);
    expect(ctx.db.select().from(applications).all()).toHaveLength(0);
    expect(getSettings(ctx.db).language).toBe('en');
    expect(kvGet(ctx.db, 'gmail:historyId')).toBeNull();
    expect(kvGet(ctx.db, 'auth:passwordHash')).toBe('hash');
    expect(existsSync(join(dir, 'files', 'documents', 'cv-1.pdf'))).toBe(false);
    expect(existsSync(join(dir, 'browser', 'Default'))).toBe(false);
    expect(await ctx.secrets.get('anthropic_api_key')).toBeNull();
    // the app keeps working afterwards
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/board' })).statusCode).toBe(200);
  });
});
