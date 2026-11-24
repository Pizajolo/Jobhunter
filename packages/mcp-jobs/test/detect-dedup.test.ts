import { describe, expect, it } from 'vitest';
import { detectFromHtml, detectFromUrl, findDuplicate, normalizeJobs, slugCandidates, parseSalary, type ExistingJobKey } from '../src/index.js';

describe('ATS detection', () => {
  it.each([
    ['https://boards.greenhouse.io/lumenrobotics', 'greenhouse', 'lumenrobotics'],
    ['https://job-boards.greenhouse.io/lumenrobotics/jobs/4001', 'greenhouse', 'lumenrobotics'],
    ['https://jobs.lever.co/fjordmobility', 'lever', 'fjordmobility'],
    ['https://jobs.eu.lever.co/fjordmobility', 'lever', 'fjordmobility'],
    ['https://jobs.ashbyhq.com/tejoanalytics', 'ashby', 'tejoanalytics'],
    ['https://careers.smartrecruiters.com/QuarryHealth', 'smartrecruiters', 'QuarryHealth'],
    ['https://apply.workable.com/orbitfreight/', 'workable', 'orbitfreight'],
    ['https://cobaltenergy.recruitee.com/', 'recruitee', 'cobaltenergy'],
    ['https://alpenforge.jobs.personio.de/', 'personio', 'alpenforge'],
    ['https://meridian.wd3.myworkdayjobs.com/en-US/External', 'workday', 'meridian'],
  ])('%s → %s', (url, kind, slug) => {
    expect(detectFromUrl(url)).toMatchObject({ kind, slug });
  });
  it('finds an embedded board in a company careers page', () => {
    const html = '<script src="https://boards.greenhouse.io/embed/job_board/js?for=lumenrobotics"></script>';
    expect(detectFromHtml(html, 'https://lumen.example/careers')).toMatchObject({ kind: 'greenhouse', slug: 'lumenrobotics' });
    expect(detectFromHtml('<a href="https://jobs.lever.co/acme/123">Apply</a>', 'https://acme.example')).toMatchObject({ kind: 'lever', slug: 'acme' });
    expect(detectFromHtml('<p>no ats</p>', 'https://acme.example/careers')).toBeNull();
  });
  it('builds slug candidates', () => {
    expect(slugCandidates('Lumen Robotics AG')).toEqual(['lumenrobotics', 'lumen-robotics']);
  });
  it('parses salary text', () => {
    expect(parseSalary('€150K – €250K')).toEqual({ min: 150000, max: 250000, currency: 'EUR', period: 'year' });
    expect(parseSalary('CHF 120,000 - 140,000 per year')).toMatchObject({ min: 120000, max: 140000, currency: 'CHF' });
  });
});

function job(over: Partial<{ title: string; company: string; location: string; url: string; sourceJobId: string }>) {
  const { jobs } = normalizeJobs([
    { sourceJobId: over.sourceJobId ?? '1', title: over.title ?? 'Senior Product Manager', company: over.company ?? 'Lumen Robotics AG', location: over.location ?? 'Zurich, Switzerland', url: over.url ?? 'https://a.example/1' },
  ]);
  return { ...jobs[0]!, atsType: 'greenhouse' };
}
function key(j: ReturnType<typeof job>, id: number, atsType = 'greenhouse'): ExistingJobKey {
  return { id, atsType, atsJobId: j.sourceJobId, canonicalUrl: j.canonicalUrl, normCompany: j.normCompany, normTitle: j.normTitle, normLocation: j.normLocation };
}

describe('dedup', () => {
  const base = job({});
  it('matches the same ATS id', () => {
    expect(findDuplicate(job({ url: 'https://other.example/x' }), [key(base, 1)])).toBe(1);
  });
  it('matches the same canonical URL across sources', () => {
    const fromRss = { ...job({ sourceJobId: 'zzz', url: 'https://a.example/1?utm_source=rss' }), atsType: 'rss' };
    expect(findDuplicate(fromRss, [key(base, 7)])).toBe(7);
  });
  it('matches same company + similar title + similar location', () => {
    const alert = { ...job({ sourceJobId: 'li-1', url: 'https://linkedin.example/jobs/9', title: 'Sr. Product Manager (m/w/d)', company: 'Lumen Robotics', location: 'Zurich' }), atsType: 'email_alert' };
    expect(findDuplicate(alert, [key(base, 3)])).toBe(3);
  });
  it('keeps different roles and locations apart', () => {
    expect(findDuplicate({ ...job({ sourceJobId: '2', url: 'https://a.example/2', title: 'Office Manager' }) }, [key(base, 1)])).toBeNull();
    expect(findDuplicate({ ...job({ sourceJobId: '3', url: 'https://a.example/3', location: 'Lisbon, Portugal' }) }, [key(base, 1)])).toBeNull();
    expect(findDuplicate({ ...job({ sourceJobId: '4', url: 'https://a.example/4', company: 'Other Corp' }) }, [key(base, 1)])).toBeNull();
  });
});
