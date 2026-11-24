import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { applications, applyRuns, documents, eq, jobs, matches, saveProfile, updateSettings } from '@jobhunter/db';
import { EMPTY_PROFILE } from '@jobhunter/shared';
import { browserSession, startApply } from '../src/apply/service.js';
import { FIXTURES, testApp, waitFor } from './support/helpers.js';

let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = (req.url ?? '/').split('?')[0]!.slice(1);
    try {
      const body = readFileSync(join(FIXTURES, 'forms', file));
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function setup(form: string, opts: { score?: number; level?: 'prepare' | 'submit'; approved?: boolean; url?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-apply-e-'));
  const t = await testApp({ dataDir: dir, filesDir: join(dir, 'files'), browserProfileDir: join(dir, 'browser'), headlessBrowser: true });
  const { ctx } = t;
  updateSettings(ctx.db, { autoApply: { level: opts.level ?? 'prepare' } });
  saveProfile(ctx.db, { ...EMPTY_PROFILE, basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example', email: 'alex@example.com', phone: '+41 00 000 00 00' } }, 'manual');
  const url = opts.url ?? `${base}/${form}`;
  const job = ctx.db.insert(jobs).values({ company: 'Lumen Robotics', normCompany: 'lumen robotics', title: 'Senior Product Manager', normTitle: 'x', url, canonicalUrl: url, applyUrl: url, atsType: 'greenhouse', atsJobId: '4001', contentHash: 'h' }).returning().get();
  ctx.db.insert(matches).values({ jobId: job.id, score: opts.score ?? 90, reasons: [], gaps: [] }).run();
  const app = ctx.db.insert(applications).values({ jobId: job.id, status: 'ready' }).returning().get();
  const cv = join(dir, 'CV.pdf');
  const letter = join(dir, 'Letter.pdf');
  writeFileSync(cv, '%PDF-1.4');
  writeFileSync(letter, '%PDF-1.4');
  const approvedAt = opts.approved === false ? null : new Date().toISOString();
  ctx.db.insert(documents).values([
    { applicationId: app.id, type: 'cv', language: 'en', content: { sections: [], summaryFactIds: [], gaps: [] }, pdfPath: cv, approvedAt },
    { applicationId: app.id, type: 'cover_letter', language: 'en', content: { greeting: 'Dear team,', paragraphs: [{ text: 'Hello.', factIds: [] }], closing: 'Best', gaps: [] }, pdfPath: letter, approvedAt },
    {
      applicationId: app.id,
      type: 'form_answers',
      language: 'en',
      content: [
        { question: 'Why do you want to work at Lumen Robotics?', answer: 'Because of the platform.', factIds: ['f1'], gap: false },
        { question: 'Are you authorized to work in this country?', answer: 'Yes', factIds: ['f2'], gap: false },
      ],
      approvedAt,
    },
  ]).run();
  t.fake.on('form_fill', () => ({ mappings: [] }));
  return { ...t, appId: app.id };
}

async function runAndWait(ctx: Parameters<typeof startApply>[0], appId: number) {
  const runId = await startApply(ctx, appId);
  await waitFor(() => ctx.db.select().from(applyRuns).where(eq(applyRuns.id, runId)).get()!.status !== 'running', 30_000);
  return ctx.db.select().from(applyRuns).where(eq(applyRuns.id, runId)).get()!;
}

describe('applying (mock forms, headless Chromium)', () => {
  it('prepare level: fills the form, stops before submit, keeps status, saves a screenshot', async () => {
    const { ctx, appId } = await setup('greenhouse.html');
    const run = await runAndWait(ctx, appId);
    expect(run.status).toBe('prepared');
    expect(existsSync(run.screenshotPath!)).toBe(true);
    expect(ctx.db.select().from(applications).get()!.status).toBe('ready');
    await browserSession(ctx).close();
  }, 60_000);

  it('submit level: submits when all conditions hold and records sender domain and reference', async () => {
    const { ctx, appId } = await setup('greenhouse.html', { level: 'submit', score: 90 });
    const run = await runAndWait(ctx, appId);
    expect(run.status).toBe('submitted');
    const app = ctx.db.select().from(applications).get()!;
    expect(app.status).toBe('applied');
    expect(app.autoSubmitted).toBe(true);
    expect(app.atsRefIds).toEqual(expect.arrayContaining(['4001', 'APP-4711']));
    expect(app.senderDomains).toContain('127.0.0.1');
    await browserSession(ctx).close();
  }, 60_000);

  it('submit level falls back to prepare below the score threshold', async () => {
    const { ctx, appId } = await setup('greenhouse.html', { level: 'submit', score: 70 });
    expect((await runAndWait(ctx, appId)).status).toBe('prepared');
    await browserSession(ctx).close();
  }, 60_000);

  it('submit level respects the daily cap', async () => {
    const { ctx, appId } = await setup('greenhouse.html', { level: 'submit', score: 95 });
    updateSettings(ctx.db, { autoApply: { dailyCap: 0 } });
    expect((await runAndWait(ctx, appId)).status).toBe('prepared');
    await browserSession(ctx).close();
  }, 60_000);

  it('stops at a CAPTCHA even at the submit level', async () => {
    const { ctx, appId } = await setup('captcha.html', { level: 'submit', score: 99 });
    const run = await runAndWait(ctx, appId);
    expect(run).toMatchObject({ status: 'handover', stopReason: 'captcha' });
    expect(ctx.db.select().from(applications).get()!.status).toBe('ready');
    await browserSession(ctx).close();
  }, 60_000);

  it('never submits with unknown required fields', async () => {
    const { ctx, appId } = await setup('unknown.html', { level: 'submit', score: 99 });
    const run = await runAndWait(ctx, appId);
    expect(run).toMatchObject({ status: 'prepared', stopReason: 'unknown_fields' });
    await browserSession(ctx).close();
  }, 60_000);

  it('refuses LinkedIn and unapproved packages', async () => {
    const li = await setup('greenhouse.html', { level: 'submit', url: 'https://www.linkedin.com/jobs/view/123' });
    expect((await runAndWait(li.ctx, li.appId)).stopReason).toBe('excluded_site');
    const na = await setup('greenhouse.html', { level: 'submit', approved: false });
    expect((await runAndWait(na.ctx, na.appId)).stopReason).toBe('not_approved');
  }, 60_000);
});
