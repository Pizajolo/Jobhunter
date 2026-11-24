import { describe, expect, it } from 'vitest';
import { ADAPTERS, normalizeJobs, type PageExtractor, type SourceConfig } from '../src/index.js';
import { FixtureFetcher } from './fixture-fetcher.js';

async function run(config: SourceConfig, extractor?: PageExtractor) {
  const fetch = new FixtureFetcher();
  const raw = await ADAPTERS[config.kind]!.list(config, { fetch, extractor });
  const { jobs, invalid } = normalizeJobs(raw);
  expect(invalid).toBe(0);
  return { jobs, fetch };
}

describe('ATS adapters (recorded fixtures)', () => {
  it('greenhouse', async () => {
    const { jobs } = await run({ kind: 'greenhouse', slug: 'lumenrobotics', company: 'Lumen Robotics' });
    expect(jobs).toHaveLength(2);
    const j = jobs[0]!;
    expect(j.title).toBe('Senior Product Manager, AI Platform');
    expect(j.description).toContain('Own the AI platform roadmap');
    expect(j.description).not.toContain('&lt;');
    expect(j.remote).toBe('hybrid');
    expect(j.canonicalUrl).toBe('https://job-boards.greenhouse.io/lumenrobotics/jobs/4001');
    expect(j.postedAt).toMatch(/^2026-11-19/u);
  });
  it('lever', async () => {
    const { jobs } = await run({ kind: 'lever', slug: 'fjordmobility', company: 'Fjord Mobility' });
    expect(jobs.map((j) => j.title)).toEqual(['Product Manager, Autonomy', 'Backend Engineer']);
    expect(jobs[0]!.remote).toBe('remote');
    expect(jobs[0]!.salary).toEqual({ min: 90000, max: 120000, currency: 'EUR', period: 'year' });
    expect(jobs[0]!.description).toContain('5+ years in product management');
    expect(jobs[1]!.remote).toBe('onsite');
  });
  it('ashby skips unlisted jobs and reads compensation', async () => {
    const { jobs } = await run({ kind: 'ashby', slug: 'tejoanalytics', company: 'Tejo Analytics' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.location).toBe('Lisbon / Porto');
    expect(jobs[0]!.salary?.currency).toBe('EUR');
    expect(jobs[0]!.remote).toBe('onsite');
  });
  it('smartrecruiters with details', async () => {
    const { jobs } = await run({ kind: 'smartrecruiters', slug: 'QuarryHealth' });
    expect(jobs[0]!.company).toBe('Quarry Health AG');
    expect(jobs[0]!.remote).toBe('hybrid');
    expect(jobs[0]!.description).toContain('Drive the digital strategy');
  });
  it('workable', async () => {
    const { jobs } = await run({ kind: 'workable', slug: 'orbitfreight' });
    expect(jobs[0]!).toMatchObject({ title: 'AI Solutions Lead', company: 'Orbit Freight', remote: 'remote' });
  });
  it('recruitee', async () => {
    const { jobs } = await run({ kind: 'recruitee', slug: 'cobaltenergy' });
    expect(jobs[0]!.salary).toEqual({ min: 130000, max: 150000, currency: 'CHF', period: 'year' });
    expect(jobs[0]!.remote).toBe('hybrid');
  });
  it('personio XML', async () => {
    const { jobs } = await run({ kind: 'personio', slug: 'alpenforge' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.description).toContain('Lead 30 engineers');
    expect(jobs[0]!.url).toBe('https://alpenforge.jobs.personio.de/job/1001');
    expect(jobs[1]!.normTitle).toBe('werkstudent marketing');
  });
  it('workday CXS JSON', async () => {
    const { jobs, fetch } = await run({ kind: 'workday', url: 'https://meridian.wd3.myworkdayjobs.com/en-US/External' });
    expect(fetch.requests[0]).toMatch(/^POST /u);
    expect(jobs[0]!).toMatchObject({ title: 'Founding Product Manager', company: 'Meridian Works', sourceJobId: 'R-100', remote: 'hybrid' });
  });
  it('rss with company: title items', async () => {
    const { jobs } = await run({ kind: 'rss', url: 'https://remote-board.example/remote-jobs.rss', options: { titleFormat: 'company: title' } });
    expect(jobs.map((j) => [j.company, j.title])).toEqual([
      ['Sable Insurance', 'AI Transformation Manager'],
      ['Kestrel Data', 'Solutions Architect'],
    ]);
    expect(jobs[1]!.remote).toBe('remote');
  });
  it('arbeitnow filters by keywords', async () => {
    const { jobs } = await run({ kind: 'arbeitnow', options: { keywords: ['product'] } });
    expect(jobs.map((j) => j.title)).toEqual(['Product Manager (m/w/d)']);
  });
  it('generic careers page: model extraction, pagination, detail pages', async () => {
    const pages: string[] = [];
    const extractor: PageExtractor = {
      async extract(page) {
        pages.push(page.url);
        expect(page.text).not.toContain('var x=1');
        const jobs = page.links
          .filter((l) => /\/careers\/[a-z-]+$/u.test(l.href))
          .map((l) => ({ title: l.text, location: null, url: l.href, description: null }));
        const next = page.links.find((l) => l.text === 'Next page')?.href ?? null;
        return { jobs, nextPageUrl: next };
      },
    };
    const { jobs } = await run({ kind: 'generic', url: 'https://halden-group.example/careers', company: 'Halden Group' }, extractor);
    expect(pages).toHaveLength(2);
    expect(jobs.map((j) => j.title)).toEqual(['Strategy Consultant', 'Data Analyst', 'Head of Product']);
    expect(jobs[0]!.description).toContain('5 years of consulting experience');
    expect(jobs[1]!.remote).toBe('remote');
  });
});
