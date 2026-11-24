import { describe, expect, it } from 'vitest';
import { applications, emails, eq, jobs, saveSearchProfile, setApplicationStatus, sources, taskRuns } from '@jobhunter/db';
import { EMPTY_SEARCH_PROFILE, normalizeCompany, normalizeTitle } from '@jobhunter/shared';
import { computeStats, roleBucket } from '../src/stats/service.js';
import { testApp } from './support/helpers.js';

type Ctx = Awaited<ReturnType<typeof testApp>>['ctx'];

function addApp(ctx: Ctx, title: string, sourceId: number | null, path: ('shortlisted' | 'drafting' | 'ready' | 'applied' | 'interview' | 'rejected' | 'offer')[], appliedAt?: string) {
  const job = ctx.db
    .insert(jobs)
    .values({ company: 'Acme', normCompany: normalizeCompany('Acme'), title, normTitle: normalizeTitle(title), url: `https://acme.example/${title}`, canonicalUrl: `https://acme.example/${title}`, atsType: sourceId ? 'greenhouse' : 'generic', contentHash: title, sourceId })
    .returning({ id: jobs.id })
    .get();
  const app = ctx.db.insert(applications).values({ jobId: job.id }).returning({ id: applications.id }).get();
  for (const to of path) setApplicationStatus(ctx.db, app.id, to, to === 'interview' || to === 'rejected' || to === 'offer' ? 'email' : 'user', 'test');
  if (appliedAt) ctx.db.update(applications).set({ appliedAt }).where(eq(applications.id, app.id)).run();
  return app.id;
}

describe('stats', () => {
  it('buckets titles into the target roles', () => {
    expect(roleBucket('Senior Product Manager (m/w/d)', ['Product Manager', 'Data Analyst'])).toBe('Product Manager');
    expect(roleBucket('Office Assistant', ['Product Manager'])).toBe('other');
  });

  it('computes the funnel, rates by source and role, time to first reply and cost per task', async () => {
    const { ctx, app } = await testApp();
    saveSearchProfile(ctx.db, { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager', 'Data Analyst'] });
    const gh = ctx.db.insert(sources).values({ kind: 'greenhouse', name: 'Acme (greenhouse)', config: { kind: 'greenhouse', slug: 'acme' } }).returning({ id: sources.id }).get().id;
    const toApplied = ['shortlisted', 'drafting', 'ready', 'applied'] as const;
    addApp(ctx, 'Product Manager', gh, []); // found only
    addApp(ctx, 'Senior Product Manager', gh, ['shortlisted']);
    const a = addApp(ctx, 'Product Manager Payments', gh, [...toApplied, 'interview', 'offer'], '2026-10-01T00:00:00.000Z');
    const b = addApp(ctx, 'Data Analyst', null, [...toApplied, 'rejected'], '2026-10-01T00:00:00.000Z');
    addApp(ctx, 'Data Analyst II', null, [...toApplied]);
    // the first reply for `a` came by email after 4 days, `b` after 10 days
    const mail = (applicationId: number, receivedAt: string) =>
      ctx.db.insert(emails).values({ provider: 'imap', providerMessageId: receivedAt, fromAddress: 'hr@acme.example', fromDomain: 'acme.example', subject: 'Re', receivedAt, bodyHash: receivedAt, applicationId }).run();
    mail(a, '2026-10-05T00:00:00.000Z');
    mail(b, '2026-10-11T00:00:00.000Z');
    ctx.db.insert(taskRuns).values([
      { task: 'cv_tailor', status: 'succeeded', costUsd: 0.12, startedAt: '2026-10-02T00:00:00.000Z' },
      { task: 'cv_tailor', status: 'failed', costUsd: 0.03, startedAt: '2026-11-02T00:00:00.000Z' },
      { task: 'email_classify', status: 'succeeded', costUsd: 0.01, startedAt: '2026-11-03T00:00:00.000Z' },
      { task: 'company_discovery', status: 'skipped', costUsd: 0, startedAt: '2026-11-03T00:00:00.000Z' },
    ]).run();

    const s = computeStats(ctx);
    expect(s.funnel).toEqual({ found: 5, shortlisted: 4, applied: 3, replied: 2, interviews: 1, offers: 1 });
    // the email-driven status changes happened "now", so the earlier emails are the first replies
    expect(s.medianDaysToFirstReply).toBe(7);
    expect(s.repliesMeasured).toBe(2);
    expect(s.bySource).toEqual([
      { key: 'generic', applied: 2, replied: 1, interviews: 0, offers: 0 },
      { key: 'greenhouse', applied: 1, replied: 1, interviews: 1, offers: 1 },
    ]);
    expect(s.byRole.find((r) => r.key === 'Data Analyst')).toMatchObject({ applied: 2, replied: 1, interviews: 0 });
    expect(s.costByTask[0]).toEqual({ task: 'cv_tailor', runs: 2, failed: 1, costUsd: 0.15 });
    expect(s.costByTask.some((t) => t.task === 'company_discovery')).toBe(false);
    expect(s.costByMonth).toEqual([
      { month: '2026-10', costUsd: 0.12 },
      { month: '2026-11', costUsd: 0.04 },
    ]);
    expect(s.totalCostUsd).toBe(0.16);
    expect((await app.inject({ method: 'GET', url: '/api/stats?days=30' })).statusCode).toBe(200);
  });
});
