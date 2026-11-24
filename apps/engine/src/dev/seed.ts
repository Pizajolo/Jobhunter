import {
  addEvent,
  applications,
  companies,
  jobs,
  matches,
  saveSearchProfile,
  sources,
  updateSettings,
  type Db,
} from '@jobhunter/db';
import { EMPTY_PROFILE, EMPTY_SEARCH_PROFILE, normalizeCompany, normalizeLocation, normalizeTitle, type ApplicationStatus } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { commitProfile } from '../profile/service.js';

interface DemoJob {
  company: string;
  title: string;
  location: string;
  remote: 'remote' | 'hybrid' | 'onsite';
  ats: string;
  score: number;
  status: ApplicationStatus;
  daysAgo: number;
  appliedDaysAgo?: number;
  description: string;
}

const DEMO: DemoJob[] = [
  { company: 'Tejo Analytics', title: 'Head of Product', location: 'Lisbon', remote: 'onsite', ats: 'email_alert', score: 78, status: 'found', daysAgo: 0, description: 'Lead product for our analytics suite.' },
  { company: 'Cobalt Energy', title: 'Venture Builder', location: 'Zug', remote: 'hybrid', ats: 'recruitee', score: 74, status: 'found', daysAgo: 0, description: 'Build new energy ventures from idea to first customers.' },
  { company: 'Orbit Freight', title: 'AI Solutions Lead', location: 'Remote (EU)', remote: 'remote', ats: 'workable', score: 61, status: 'found', daysAgo: 2, description: 'Help logistics customers adopt AI.' },
  { company: 'Brightline Pay', title: 'Product Lead, Payments Infrastructure', location: 'Zurich', remote: 'hybrid', ats: 'email_alert', score: 82, status: 'drafting', daysAgo: 3, description: 'Own the payments infrastructure roadmap.' },
  { company: 'Quarry Health', title: 'Strategy Manager, Digital', location: 'Basel', remote: 'hybrid', ats: 'smartrecruiters', score: 69, status: 'shortlisted', daysAgo: 4, description: 'Drive the digital strategy of our clinics.' },
  { company: 'Lumen Robotics', title: 'Senior Product Manager, AI Platform', location: 'Zurich', remote: 'hybrid', ats: 'greenhouse', score: 86, status: 'ready', daysAgo: 3, description: 'Own the AI platform roadmap. Work with 4 engineering teams. Hybrid in Zurich.' },
  { company: 'Alpenforge AG', title: 'Director of Engineering', location: 'Zug', remote: 'onsite', ats: 'personio', score: 80, status: 'ready', daysAgo: 5, description: 'Lead 30 engineers.' },
  { company: 'Fjord Mobility', title: 'Product Manager, Autonomy', location: 'Remote (EU)', remote: 'remote', ats: 'lever', score: 70, status: 'applied', daysAgo: 9, appliedDaysAgo: 6, description: 'Driver assistance software.' },
  { company: 'Northpeak Capital', title: 'Venture Partner, Deep Tech', location: 'Zurich', remote: 'hybrid', ats: 'generic', score: 72, status: 'applied', daysAgo: 14, appliedDaysAgo: 11, description: 'Invest in deep tech.' },
  { company: 'Sable Insurance', title: 'AI Transformation Manager', location: 'Lisbon', remote: 'hybrid', ats: 'rss', score: 77, status: 'applied', daysAgo: 22, appliedDaysAgo: 19, description: 'Lead AI adoption across claims.' },
  { company: 'Meridian Works', title: 'Founding Product Manager', location: 'Zurich', remote: 'hybrid', ats: 'workday', score: 88, status: 'interview', daysAgo: 20, appliedDaysAgo: 17, description: 'Shape our first product.' },
  { company: 'Vantage Ledger', title: 'Blockchain Product Lead', location: 'Zug', remote: 'hybrid', ats: 'greenhouse', score: 84, status: 'rejected', daysAgo: 25, appliedDaysAgo: 20, description: 'Lead our ledger products.' },
  { company: 'Kestrel Data', title: 'Solutions Architect', location: 'Lisbon', remote: 'hybrid', ats: 'rss', score: 66, status: 'rejected', daysAgo: 30, appliedDaysAgo: 25, description: 'Design data platforms.' },
  { company: 'Halden Group', title: 'Strategy Consultant', location: 'Zurich', remote: 'onsite', ats: 'generic', score: 64, status: 'no_response', daysAgo: 40, appliedDaysAgo: 24, description: 'Advise clients on digital strategy.' },
];

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Synthetic demo data (fake people and companies) for screenshots, demos and end-to-end tests. */
export function seedDemo(ctx: AppContext): void {
  const db: Db = ctx.db;
  updateSettings(db, { onboardingCompleted: true });
  commitProfile(
    ctx,
    {
      ...EMPTY_PROFILE,
      basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example', label: 'Product Manager', email: 'alex@example.com', location: { city: 'Zurich', countryCode: 'CH' } },
      work: [
        { id: 'w1', name: 'Fictional Data AG', position: 'Senior Product Manager', location: 'Zurich', startDate: '2021-03', highlights: ['Led a team of 6 engineers to launch a data pipeline product used by 40 enterprise customers.', 'Grew annual recurring revenue from CHF 1.2M to CHF 3.5M in two years.'] },
        { id: 'w2', name: 'Sample Analytics GmbH', position: 'Product Manager', location: 'Berlin', startDate: '2017-01', endDate: '2021-02', highlights: ['Reduced customer onboarding time from 6 weeks to 2 weeks.'] },
      ],
      education: [{ id: 'e1', institution: 'Example Technical University', studyType: 'MSc', area: 'Computer Science', startDate: '2014', endDate: '2016', courses: [], highlights: [] }],
      skills: ['Product discovery', 'SQL', 'Python', 'Roadmapping'].map((n, i) => ({ id: `s${i}`, name: n, keywords: [] })),
      languages: [
        { id: 'l1', language: 'English', fluency: 'fluent' },
        { id: 'l2', language: 'German', fluency: 'native' },
      ],
      preferences: { workAuthorization: 'Swiss C permit', noticePeriod: '3 months', salaryExpectation: 'CHF 160,000' },
    },
    'manual',
  );
  saveSearchProfile(db, { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager', 'Head of Product', 'Venture Builder'], locations: ['Zurich', 'Zug', 'Lisbon', 'Remote'], remotePolicy: 'any' });
  for (const d of DEMO) {
    const company = db
      .insert(companies)
      .values({ name: d.company, normName: normalizeCompany(d.company), atsType: d.ats, source: 'user', watchStatus: 'watching' })
      .onConflictDoNothing()
      .returning({ id: companies.id })
      .get();
    const src = company
      ? db.insert(sources).values({ kind: d.ats, name: `${d.company} (${d.ats})`, config: { kind: d.ats, slug: normalizeCompany(d.company).replace(/\s+/gu, '') }, companyId: company.id, enabled: false }).returning({ id: sources.id }).get()
      : null;
    const url = `https://jobs.example/${normalizeCompany(d.company).replace(/\s+/gu, '-')}/${normalizeTitle(d.title).replace(/\s+/gu, '-')}`;
    const job = db
      .insert(jobs)
      .values({
        sourceId: src?.id ?? null,
        companyId: company?.id ?? null,
        company: d.company,
        normCompany: normalizeCompany(d.company),
        title: d.title,
        normTitle: normalizeTitle(d.title),
        location: d.location,
        normLocation: normalizeLocation(d.location),
        remote: d.remote,
        description: d.description,
        url,
        canonicalUrl: url,
        applyUrl: url,
        atsType: d.ats,
        atsJobId: url,
        contentHash: url,
        firstSeenAt: ago(d.daysAgo),
        lastSeenAt: ago(0),
      })
      .returning({ id: jobs.id })
      .get();
    db.insert(matches).values({ jobId: job.id, score: d.score, reasons: ['Product leadership experience matches the role', 'Location fits your search'], gaps: d.score < 75 ? ['No direct domain experience'] : [], model: 'demo' }).run();
    const changed = ago(d.status === 'found' ? d.daysAgo : Math.max(0, (d.appliedDaysAgo ?? d.daysAgo) - 2));
    const app = db
      .insert(applications)
      .values({ jobId: job.id, status: d.status, appliedAt: d.appliedDaysAgo !== undefined ? ago(d.appliedDaysAgo) : null, statusChangedAt: d.status === 'applied' ? ago(d.appliedDaysAgo!) : changed, channel: d.appliedDaysAgo !== undefined ? 'manual' : null, updatedAt: changed })
      .returning({ id: applications.id })
      .get();
    addEvent(db, { applicationId: app.id, actor: 'system', type: 'found', message: 'Found by the daily scan (demo data)' });
  }
}
