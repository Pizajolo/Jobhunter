import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applications, emails, jobs, notifications, saveProfile, saveSearchProfile, upsertFacts, updateSettings, eq } from '@jobhunter/db';
import { parseRawMessage, type EmailProvider, type RawEmail } from '@jobhunter/mcp-email';
import { EMPTY_PROFILE, EMPTY_SEARCH_PROFILE } from '@jobhunter/shared';
import { applyNoResponseRule } from '../src/email/pipeline.js';
import { setEmailProviderOverride, syncEmail } from '../src/email/service.js';
import { FIXTURES, testApp } from './support/helpers.js';
import type { BackendRequest } from '../src/agent/types.js';

const eml = (f: string) => parseRawMessage(readFileSync(join(FIXTURES, 'emails/eml', f)), { id: f });

class FakeProvider implements EmailProvider {
  readonly kind = 'gmail_api' as const;
  labels: [string, string][] = [];
  constructor(private readonly batches: RawEmail[][]) {}
  async sync(cursor: string | null) {
    const n = Number(cursor ?? 0);
    return { messages: this.batches[n] ?? [], cursor: String(n + 1) };
  }
  async addLabel(id: string, label: string) {
    this.labels.push([id, label]);
  }
  async listSent() {
    return [];
  }
  async verify() {
    return 'alex@example.com';
  }
  async close() {}
}

/** Fake classifier keyed by subject keywords. */
function classifier(req: BackendRequest) {
  const blocks = [...req.prompt.matchAll(/<email key="(\d+)">\nFrom: ([^\n]+)\nDate: [^\n]+\nSubject: ([^\n]*)/gu)];
  return {
    results: blocks.map(([, key, from, subject]) => {
      const company = /Quarry Health|Meridian/u.exec(`${from} ${subject}`)?.[0] ?? null;
      const s = subject!.toLowerCase();
      const cls = /interview|vorstellungsgespr/u.test(s) ? 'interview_invite' : /bewerbung bei|update on your|absage/u.test(s) ? 'rejection' : /new jobs|vacantes/u.test(s) ? 'job_alert' : /thank you for applying/u.test(s) ? 'application_received' : 'other';
      return { key: key!, classification: cls, company: company === 'Meridian' ? null : company, role: null, confidence: /maybe/u.test(s) ? 0.5 : 0.95, keySentence: null, referenceIds: [] };
    }),
  };
}

async function setup() {
  const t = await testApp();
  const { ctx } = t;
  updateSettings(ctx.db, { email: { provider: 'gmail_api' } });
  const mk = (company: string, title: string, status: string, domain: string) => {
    const url = `https://${domain}/jobs/1`;
    const j = ctx.db.insert(jobs).values({ company, normCompany: company.toLowerCase(), title, normTitle: title.toLowerCase(), url, canonicalUrl: url, atsType: 'generic', contentHash: url }).returning().get();
    return ctx.db.insert(applications).values({ jobId: j.id, status, appliedAt: '2026-10-01T09:00:00.000Z', senderDomains: company === 'Quarry Health' ? ['smartrecruiters.com'] : [] }).returning().get().id;
  };
  const meridian = mk('Meridian Works', 'Founding Product Manager', 'applied', 'meridianworks.example');
  const quarry = mk('Quarry Health', 'Strategy Manager, Digital', 'applied', 'quarryhealth.example');
  t.fake.on('email_classify', classifier);
  return { ...t, meridian, quarry };
}

describe('email pipeline', () => {
  it('updates statuses, labels mail, notifies interviews immediately and keeps rejections for the digest', async () => {
    const { ctx, app, fake, meridian, quarry } = await setup();
    const provider = new FakeProvider([[await eml('en-interview.eml'), await eml('de-rejection.eml'), await eml('en-personal.eml')]]);
    setEmailProviderOverride(ctx, provider);
    const r = await syncEmail(ctx);
    expect(r).toMatchObject({ changed: 2, review: 0 });
    const status = (id: number) => ctx.db.select().from(applications).where(eq(applications.id, id)).get()!.status;
    expect(status(meridian)).toBe('interview');
    expect(status(quarry)).toBe('rejected');
    // personal mail never stored
    expect(ctx.db.select().from(emails).all()).toHaveLength(2);
    expect(ctx.db.select().from(emails).all().every((e) => e.snippet.length <= 240)).toBe(true);
    expect(provider.labels.map((l) => l[1]).sort()).toEqual(['Jobhunter/Interview', 'Jobhunter/Rejected']);
    const notes = ctx.db.select().from(notifications).all();
    expect(notes.map((n) => n.kind)).toEqual(['interview']);
    expect(fake.calls.filter((c) => c.task === 'email_classify')).toHaveLength(1); // batched
    // idempotent: re-processing the same messages changes nothing
    const again = await syncEmail(ctx);
    expect(again).toMatchObject({ processed: 0 });
    const inbox = (await app.inject({ method: 'GET', url: '/api/inbox' })).json();
    expect(inbox.map((e: { applicationCompany: string }) => e.applicationCompany).sort()).toEqual(['Meridian Works', 'Quarry Health']);
  });

  it('sends low-confidence or unmatched mail to the review queue and lets the user assign it', async () => {
    const { ctx, app, meridian } = await setup();
    const msg = await eml('en-interview.eml');
    msg.subject = 'Maybe an interview?';
    setEmailProviderOverride(ctx, new FakeProvider([[msg]]));
    await syncEmail(ctx);
    expect(ctx.db.select().from(applications).where(eq(applications.id, meridian)).get()!.status).toBe('applied');
    const review = (await app.inject({ method: 'GET', url: '/api/review' })).json();
    expect(review.emails).toHaveLength(1);
    await app.inject({ method: 'POST', url: `/api/review/${review.emails[0].id}`, payload: { action: 'assign', applicationId: meridian, classification: 'interview_invite' } });
    expect(ctx.db.select().from(applications).where(eq(applications.id, meridian)).get()!.status).toBe('interview');
    expect((await app.inject({ method: 'GET', url: '/api/review' })).json().emails).toHaveLength(0);
  });

  it('turns LinkedIn job alerts into jobs on the board', async () => {
    const { ctx, fake } = await setup();
    saveProfile(ctx.db, { ...EMPTY_PROFILE, basics: { ...EMPTY_PROFILE.basics, name: 'Alex' } }, 'manual');
    upsertFacts(ctx.db, [{ id: 'f1', text: 'Product manager', source: 'manual', confirmed: true }]);
    saveSearchProfile(ctx.db, { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager', 'Product Lead'] });
    fake.on('match_score', (req: BackendRequest) => ({ results: [...req.prompt.matchAll(/<job key="(\d+)">/gu)].map(([, key]) => ({ key: key!, score: 80, reasons: [], gaps: [] })) }));
    setEmailProviderOverride(ctx, new FakeProvider([[await eml('en-linkedin-alert.eml')]]));
    await syncEmail(ctx);
    const alertJobs = ctx.db.select().from(jobs).where(eq(jobs.atsType, 'email_alert')).all();
    expect(alertJobs.map((j) => j.company).sort()).toEqual(['Aurora Labs', 'Glacier Bank']);
    expect(ctx.db.select().from(applications).all().filter((a) => a.status === 'found')).toHaveLength(2);
  });

  it('marks applications without any reply after N days as no response', async () => {
    const { ctx, meridian } = await setup();
    updateSettings(ctx.db, { noResponseAfterDays: 21 });
    const changed = applyNoResponseRule(ctx, new Date('2026-11-24T00:00:00Z'));
    expect(changed).toContain(meridian);
    // a later email still updates the status normally
    expect(ctx.db.select().from(applications).where(eq(applications.id, meridian)).get()!.status).toBe('no_response');
    setEmailProviderOverride(ctx, new FakeProvider([[await eml('en-interview.eml')]]));
    await syncEmail(ctx);
    expect(ctx.db.select().from(applications).where(eq(applications.id, meridian)).get()!.status).toBe('interview');
  });
});

describe('daily digest', () => {
  it('collects rejections into one notification', async () => {
    const { sendDailyDigest } = await import('../src/email/service.js');
    const { ctx, quarry } = await setup();
    const { setApplicationStatus } = await import('@jobhunter/db');
    setApplicationStatus(ctx.db, quarry, 'rejected', 'email', 'Rejected');
    expect(sendDailyDigest(ctx)).toBe(1);
    const n = ctx.db.select().from(notifications).all();
    expect(n).toHaveLength(1);
    expect(n[0]!.body).toContain('Quarry Health');
    expect(sendDailyDigest(ctx)).toBe(0);
  });
});
