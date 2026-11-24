import { describe, expect, it } from 'vitest';
import { applications, companies, getSearchProfile, jobs, matches, notifications, saveSearchProfile, scanRuns, sources, updateSettings, upsertFacts, saveProfile } from '@jobhunter/db';
import { EMPTY_PROFILE, EMPTY_SEARCH_PROFILE } from '@jobhunter/shared';
import { PoliteFetcher } from '../src/scan/fetcher.js';
import { prefilter } from '../src/scan/matching.js';
import { runScan, scanTestOverrides } from '../src/scan/pipeline.js';
import { addCompany } from '../src/scan/companies.js';
import { lastScheduled, nextScheduled } from '../src/scheduler.js';
import { fixtureFetch } from './support/fixture-fetch.js';
import { testApp } from './support/helpers.js';
import type { BackendRequest } from '../src/agent/types.js';

function seedProfile(ctx: Parameters<typeof saveProfile>[0] extends infer D ? { db: D } : never) {
  saveProfile(ctx.db, { ...EMPTY_PROFILE, basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example' } }, 'manual');
  upsertFacts(ctx.db, [{ id: 'f1', text: 'Senior Product Manager at Fictional Data AG', source: 'manual', confirmed: true }]);
  saveSearchProfile(ctx.db, { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager', 'Head of Product'], locations: ['Zurich', 'Remote', 'Lisbon'], exclusions: ['intern'] });
}

/** Fake scorer: product roles score high, everything else low. */
function scorer(req: BackendRequest) {
  const keys = [...req.prompt.matchAll(/<job key="(\d+)">\nTitle: ([^\n]+)/gu)];
  return { results: keys.map(([, key, title]) => ({ key: key!, score: /product/iu.test(title!) ? 88 : 30, reasons: ['fit'], gaps: [] })) };
}

describe('polite fetcher', () => {
  it('respects robots.txt, rate limits per domain, caps pages per day and caches', async () => {
    const { ctx } = await testApp();
    const sleeps: number[] = [];
    let now = 1_000_000;
    const { impl, calls } = fixtureFetch({
      'https://blocked.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private' },
      'https://blocked.example/private/jobs': { status: 200, body: 'secret' },
      'https://blocked.example/public': { status: 200, body: 'ok', headers: { etag: '"v1"' } },
    });
    const f = new PoliteFetcher(ctx.db, { minIntervalMs: 5000, maxPagesPerDomainPerDay: 3, freshMs: 0, fetchImpl: impl, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await expect(f.text('https://blocked.example/private/jobs')).rejects.toThrow(/robots/u);
    await f.text('https://blocked.example/public');
    await f.text('https://blocked.example/public');
    expect(sleeps.every((s) => s <= 5000)).toBe(true);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5000);
    const sent = calls.filter((c) => c.includes('/public'));
    expect(sent).toHaveLength(2);
    await f.text('https://blocked.example/public');
    await expect(f.text('https://blocked.example/public')).rejects.toThrow(/Daily limit/u);
    // fresh cache: no network at all
    const cached = new PoliteFetcher(ctx.db, { minIntervalMs: 0, maxPagesPerDomainPerDay: 99, freshMs: 3600_000, fetchImpl: impl, now: () => now });
    const before = calls.length;
    const r = await cached.text('https://blocked.example/public');
    expect(r.fromCache).toBe(true);
    expect(calls.length).toBe(before);
  });
});

describe('scan pipeline', () => {
  it('scans sources, dedups, survives a failing source and shows matches above the threshold', async () => {
    const { ctx, fake } = await testApp();
    const { impl } = fixtureFetch();
    scanTestOverrides.set(ctx, { fetchImpl: impl, minIntervalMs: 0, sleep: async () => undefined });
    seedProfile(ctx);
    fake.on('match_score', scorer);
    ctx.db.insert(sources).values([
      { kind: 'greenhouse', name: 'Lumen', config: { kind: 'greenhouse', slug: 'lumenrobotics', company: 'Lumen Robotics' } },
      { kind: 'lever', name: 'Fjord', config: { kind: 'lever', slug: 'fjordmobility', company: 'Fjord Mobility' } },
      { kind: 'ashby', name: 'Broken', config: { kind: 'ashby', slug: 'does-not-exist' } },
    ]).run();
    const r1 = await runScan(ctx, 'manual');
    expect(r1.sourcesTotal).toBe(3);
    expect(r1.sourcesFailed).toBe(1);
    expect(r1.jobsNew).toBe(4);
    const broken = ctx.db.select().from(sources).all().find((s) => s.name === 'Broken')!;
    expect(broken.lastError).toMatch(/404/u);
    const ok = ctx.db.select().from(sources).all().find((s) => s.name === 'Lumen')!;
    expect(ok.lastSuccessAt).not.toBeNull();
    // Office Manager is filtered (title not a target role); Backend Engineer is onsite in Oslo (location)
    const ms = ctx.db.select().from(matches).all();
    expect(ms.filter((m) => !m.prefilterPassed)).toHaveLength(2);
    const apps = ctx.db.select().from(applications).all();
    expect(apps).toHaveLength(2);
    expect(apps.every((a) => a.status === 'found')).toBe(true);
    expect(ctx.db.select().from(notifications).all()).toHaveLength(1);
    // Second scan: nothing new, no duplicate cards
    const r2 = await runScan(ctx, 'manual');
    expect(r2.jobsNew).toBe(0);
    expect(ctx.db.select().from(jobs).all()).toHaveLength(4);
    expect(ctx.db.select().from(applications).all()).toHaveLength(2);
    expect(ctx.db.select().from(scanRuns).all().map((s) => s.status)).toEqual(['partial', 'partial']);
  });

  it('auto-shortlists above the configured threshold', async () => {
    const { ctx, fake } = await testApp();
    const { impl } = fixtureFetch();
    scanTestOverrides.set(ctx, { fetchImpl: impl, minIntervalMs: 0, sleep: async () => undefined });
    seedProfile(ctx);
    fake.on('match_score', scorer);
    updateSettings(ctx.db, { matchThresholdAutoShortlist: 85 });
    ctx.db.insert(sources).values({ kind: 'lever', name: 'Fjord', config: { kind: 'lever', slug: 'fjordmobility' } }).run();
    await runScan(ctx, 'manual');
    expect(ctx.db.select().from(applications).all().map((a) => a.status)).toEqual(['shortlisted']);
  });

  it('extracts generic careers pages with the model and caches unchanged pages', async () => {
    const { ctx, fake } = await testApp();
    const { impl } = fixtureFetch();
    scanTestOverrides.set(ctx, { fetchImpl: impl, minIntervalMs: 0, sleep: async () => undefined, freshMs: 0 });
    seedProfile(ctx);
    fake.on('match_score', scorer);
    fake.on('job_extract', (req) => {
      const links = [...req.prompt.matchAll(/^(.+) -> (https:\/\/halden-group\.example\/careers\/[a-z-]+)$/gmu)];
      const next = /Next page -> (\S+)/u.exec(req.prompt)?.[1] ?? null;
      return { jobs: links.map(([, title, url]) => ({ title: title!, location: null, url: url!, description: null })), nextPageUrl: next };
    });
    ctx.db.insert(sources).values({ kind: 'generic', name: 'Halden', config: { kind: 'generic', url: 'https://halden-group.example/careers', company: 'Halden Group' } }).run();
    const r = await runScan(ctx, 'manual');
    expect(r.jobsNew).toBe(3);
    const extractCalls = fake.calls.filter((c) => c.task === 'job_extract').length;
    expect(extractCalls).toBe(2);
    await runScan(ctx, 'manual');
    expect(fake.calls.filter((c) => c.task === 'job_extract').length).toBe(extractCalls);
  });

  it('adds companies and detects their ATS', async () => {
    const { ctx } = await testApp();
    const { impl } = fixtureFetch({ 'https://lumen.example/careers': { status: 200, body: '<script src="https://boards.greenhouse.io/embed/job_board/js?for=lumenrobotics"></script>' } });
    scanTestOverrides.set(ctx, { fetchImpl: impl, minIntervalMs: 0, sleep: async () => undefined });
    const a = await addCompany(ctx, { name: 'Lumen Robotics', careersUrl: 'https://lumen.example/careers' });
    expect(a.detected).toMatchObject({ kind: 'greenhouse', slug: 'lumenrobotics' });
    const b = await addCompany(ctx, { careersUrl: 'https://jobs.lever.co/fjordmobility' });
    expect(b.detected?.kind).toBe('lever');
    const again = await addCompany(ctx, { name: 'Lumen Robotics AG' });
    expect(again.existed).toBe(true);
    expect(ctx.db.select().from(companies).all()).toHaveLength(2);
  });
});

describe('prefilter', () => {
  const s = { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager'], locations: ['Zurich'], remotePolicy: 'any' as const, exclusions: ['consulting'], minSalary: { amount: 120000, currency: 'CHF' } };
  const base = { title: 'Senior Product Manager', company: 'A', location: 'Zurich, Switzerland', remote: 'hybrid', language: null, description: '', salary: null };
  it('passes a fitting job', () => expect(prefilter(base, s).pass).toBe(true));
  it('rejects excluded keywords, wrong location, low salary and wrong roles', () => {
    expect(prefilter({ ...base, title: 'Product Manager, Consulting' }, s).pass).toBe(false);
    expect(prefilter({ ...base, location: 'Berlin' }, s).pass).toBe(false);
    expect(prefilter({ ...base, location: 'Berlin', remote: 'remote' }, s).pass).toBe(true);
    expect(prefilter({ ...base, salary: { min: 90000, max: 100000, currency: 'CHF', period: 'year' } }, s).pass).toBe(false);
    expect(prefilter({ ...base, salary: { min: 90000, max: 100000, currency: 'EUR', period: 'year' } }, s).pass).toBe(true);
    expect(prefilter({ ...base, title: 'Accountant' }, s).pass).toBe(false);
  });
  it('remote-only rejects onsite and hybrid', () => {
    expect(prefilter(base, { ...s, remotePolicy: 'remote_only' }).pass).toBe(false);
  });
});

describe('scheduler', () => {
  it('computes due and next times, including catch-up after sleep', () => {
    const now = new Date(2026, 10, 24, 9, 30);
    const daily = { kind: 'daily' as const, time: '07:00' };
    expect(lastScheduled(daily, now, null)).toEqual(new Date(2026, 10, 24, 7, 0));
    expect(nextScheduled(daily, now, null)).toEqual(new Date(2026, 10, 25, 7, 0));
    const early = new Date(2026, 10, 24, 6, 0);
    expect(lastScheduled(daily, early, null)).toEqual(new Date(2026, 10, 23, 7, 0));
    const weekly = { kind: 'weekly' as const, weekday: 1, time: '06:00' };
    expect(lastScheduled(weekly, now, null)!.getDay()).toBe(1);
  });
});

describe('chat proposals', () => {
  it('proposes a search profile change as a diff and applies it only on confirmation', async () => {
    const { ctx, app, fake } = await testApp();
    fake.on('chat', () => ({
      reply: 'I will add climate tech and Lisbon.',
      proposal: { kind: 'search_profile', summary: 'Add climate tech in Lisbon', searchProfile: { ...EMPTY_SEARCH_PROFILE, industries: ['climate tech'], locations: ['Lisbon'] } },
    }));
    const msgs = (await app.inject({ method: 'POST', url: '/api/chat', payload: { content: 'also look at climate tech in Lisbon' } })).json();
    const last = msgs.at(-1);
    expect(last.proposal.diff).toEqual([
      { path: 'search.locations', op: 'add', after: 'Lisbon' },
      { path: 'search.industries', op: 'add', after: 'climate tech' },
    ]);
    expect(getSearchProfile(ctx.db).data.locations).toEqual([]);
    await app.inject({ method: 'POST', url: `/api/chat/proposals/${last.id}/apply` });
    expect(getSearchProfile(ctx.db).data.locations).toEqual(['Lisbon']);
    const again = await app.inject({ method: 'POST', url: `/api/chat/proposals/${last.id}/apply` });
    expect(again.statusCode).toBe(400);
  });
});
