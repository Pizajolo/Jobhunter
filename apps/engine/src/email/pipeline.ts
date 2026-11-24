import { createHash } from 'node:crypto';
import {
  addEvent,
  applications,
  companies,
  eq,
  emails,
  getSettings,
  inArray,
  jobs,
  setApplicationStatus,
  sources,
  and,
} from '@jobhunter/db';
import {
  looksLikeBulk,
  matchEmail,
  parseLinkedInAlert,
  prefilter,
  stripQuoted,
  type EmailProvider,
  type MatchCandidate,
  type RawEmail,
} from '@jobhunter/mcp-email';
import { normalizeJobs } from '@jobhunter/mcp-jobs';
import {
  EMAIL_CLASS_TO_STATUS,
  LABEL_PREFIX,
  canTransition,
  domainOf,
  normalizeCompany,
  type ApplicationStatus,
  type EmailClass,
} from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { notify } from '../notify.js';
import { batchSize, batches, runTask } from '../agent/runner.js';
import { alertParseTask, emailClassifyTask, type ClassifyOutputT } from '../tasks/email.js';
import { matchJobs, promoteMatches, upsertJobs } from '../scan/pipeline.js';

export const LABELS: Partial<Record<EmailClass, string>> = {
  application_received: `${LABEL_PREFIX}/Applied`,
  rejection: `${LABEL_PREFIX}/Rejected`,
  interview_invite: `${LABEL_PREFIX}/Interview`,
  assessment: `${LABEL_PREFIX}/Assessment`,
  offer: `${LABEL_PREFIX}/Offer`,
  job_alert: `${LABEL_PREFIX}/Job alert`,
  recruiter_outreach: `${LABEL_PREFIX}/Recruiter`,
};
export const REVIEW_LABEL = `${LABEL_PREFIX}/Review`;

/** Minimum match confidence for an automatic status change (on top of the classification threshold). */
export const MATCH_CONFIDENCE = 0.6;

export function matchCandidates(ctx: AppContext): MatchCandidate[] {
  const rows = ctx.db
    .select({ app: applications, job: jobs, website: companies.website, careersUrl: companies.careersUrl })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .all();
  return rows
    .filter((r) => !['found', 'dismissed'].includes(r.app.status))
    .map((r) => {
      const site = r.website ?? r.careersUrl ?? r.job.url;
      const host = domainOf(site);
      const companyDomain = host && !/greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|recruitee|personio|myworkday|linkedin|example\/jobs/iu.test(host) ? host : null;
      return {
        applicationId: r.app.id,
        company: r.job.company,
        title: r.job.title,
        status: r.app.status,
        senderDomains: r.app.senderDomains,
        atsRefIds: r.app.atsRefIds,
        companyDomain,
        appliedAt: r.app.appliedAt,
      };
    });
}

export interface ProcessOutcome {
  emailId: number;
  providerMessageId: string;
  classification: EmailClass | null;
  confidence: number | null;
  applicationId: number | null;
  action: 'status_changed' | 'linked' | 'review' | 'alert' | 'inbox' | 'ignored' | 'filtered';
  newStatus?: ApplicationStatus;
}

/**
 * The email pipeline (spec §5.5): prefilter → classify (batched) → match → act or send to review.
 * Only job-related mail is stored, and only a snippet and a body hash.
 */
export async function processEmails(ctx: AppContext, list: RawEmail[], provider: EmailProvider | null, providerKind: string): Promise<ProcessOutcome[]> {
  const settings = getSettings(ctx.db);
  const candidates = matchCandidates(ctx);
  const companyDomains = candidates.flatMap((c) => [...c.senderDomains, ...(c.companyDomain ? [c.companyDomain] : [])]);
  const companyNames = [...new Set(candidates.map((c) => normalizeCompany(c.company)))];
  const outcomes: ProcessOutcome[] = [];
  const toClassify: { row: number; email: RawEmail }[] = [];

  for (const e of list) {
    const existing = ctx.db.select({ id: emails.id }).from(emails).where(and(eq(emails.provider, providerKind), eq(emails.providerMessageId, e.providerMessageId))).get();
    if (existing) continue;
    const pf = prefilter(e, { companyDomains, companyNames });
    if (!pf.pass) {
      outcomes.push({ emailId: 0, providerMessageId: e.providerMessageId, classification: null, confidence: null, applicationId: null, action: 'filtered' });
      continue;
    }
    const body = stripQuoted(e.text);
    const row = ctx.db
      .insert(emails)
      .values({
        provider: providerKind,
        providerMessageId: e.providerMessageId,
        threadId: e.threadId,
        fromAddress: e.fromAddress,
        fromDomain: e.fromAddress.slice(e.fromAddress.lastIndexOf('@') + 1),
        subject: e.subject.slice(0, 500),
        receivedAt: e.receivedAt,
        snippet: body.replace(/\s+/gu, ' ').slice(0, 240),
        bodyHash: createHash('sha256').update(e.text).digest('hex'),
        prefilter: pf.reason,
      })
      .returning({ id: emails.id })
      .get();
    toClassify.push({ row: row.id, email: e });
  }

  const results = new Map<string, ClassifyOutputT['results'][number]>();
  for (const batch of batches(toClassify, batchSize(settings, 'email_classify'))) {
    const r = await runTask(ctx, emailClassifyTask, {
      emails: batch.map((b) => ({ key: String(b.row), from: `${b.email.fromName} <${b.email.fromAddress}>`, subject: b.email.subject, date: b.email.receivedAt, text: stripQuoted(b.email.text).slice(0, 3500) })),
      applications: candidates.slice(0, 80).map((c) => ({ company: c.company, title: c.title })),
    });
    if (r.ok) for (const res of r.output.results) results.set(res.key, res);
  }

  for (const { row, email } of toClassify) {
    const res = results.get(String(row));
    if (!res) {
      ctx.db.update(emails).set({ reviewStatus: 'pending', processedAt: new Date().toISOString() }).where(eq(emails.id, row)).run();
      outcomes.push({ emailId: row, providerMessageId: email.providerMessageId, classification: null, confidence: null, applicationId: null, action: 'review' });
      continue;
    }
    let cls = res.classification;
    if (cls !== 'other' && cls !== 'job_alert' && looksLikeBulk(email) && res.confidence < 0.95) cls = 'other';
    ctx.db
      .update(emails)
      .set({ classification: cls, confidence: res.confidence, keySentence: res.keySentence, company: res.company, role: res.role, processedAt: new Date().toISOString() })
      .where(eq(emails.id, row))
      .run();
    const outcome = await act(ctx, row, email, { ...res, classification: cls }, candidates, settings.emailReviewConfidence);
    outcomes.push(outcome);
    if (provider && settings.email.applyLabels) {
      const label = outcome.action === 'review' ? REVIEW_LABEL : LABELS[cls];
      if (label) {
        try {
          await provider.addLabel(email.providerMessageId, label);
          ctx.db.update(emails).set({ labelsApplied: [label] }).where(eq(emails.id, row)).run();
        } catch (err) {
          ctx.log.warn({ err: String(err) }, 'could not apply label');
        }
      }
    }
  }
  ctx.bus.invalidate('inbox', 'review', 'board', 'summary');
  return outcomes;
}

async function act(
  ctx: AppContext,
  emailId: number,
  email: RawEmail,
  res: ClassifyOutputT['results'][number],
  candidates: MatchCandidate[],
  threshold: number,
): Promise<ProcessOutcome> {
  const base = { emailId, providerMessageId: email.providerMessageId, classification: res.classification, confidence: res.confidence };
  if (res.classification === 'other') {
    ctx.db.update(emails).set({ reviewStatus: 'none' }).where(eq(emails.id, emailId)).run();
    return { ...base, applicationId: null, action: 'ignored' };
  }
  if (res.classification === 'job_alert') {
    await ingestAlert(ctx, email);
    ctx.db.update(emails).set({ reviewStatus: 'auto' }).where(eq(emails.id, emailId)).run();
    return { ...base, applicationId: null, action: 'alert' };
  }
  const match = matchEmail({ fromAddress: email.fromAddress, subject: email.subject, text: email.text, company: res.company, role: res.role, referenceIds: res.referenceIds }, candidates);
  if (res.classification === 'recruiter_outreach') {
    ctx.db.update(emails).set({ reviewStatus: 'none', applicationId: match && match.confidence >= MATCH_CONFIDENCE ? match.applicationId : null }).where(eq(emails.id, emailId)).run();
    return { ...base, applicationId: null, action: 'inbox' };
  }
  if (res.confidence < threshold || !match || match.confidence < MATCH_CONFIDENCE) {
    ctx.db.update(emails).set({ reviewStatus: 'pending', applicationId: match?.applicationId ?? null, matchConfidence: match?.confidence ?? null }).where(eq(emails.id, emailId)).run();
    return { ...base, applicationId: match?.applicationId ?? null, action: 'review' };
  }
  return linkAndUpdate(ctx, emailId, match.applicationId, res.classification, 'email', match.confidence, email);
}

/** Link an email to an application and apply the status change the email implies, if allowed. */
export function linkAndUpdate(
  ctx: AppContext,
  emailId: number,
  applicationId: number,
  cls: EmailClass,
  actor: 'email' | 'user',
  matchConfidence: number | null,
  email: { fromAddress: string; subject: string; receivedAt: string },
): ProcessOutcome {
  const app = ctx.db.select().from(applications).where(eq(applications.id, applicationId)).get()!;
  const target = EMAIL_CLASS_TO_STATUS[cls];
  const dom = email.fromAddress.slice(email.fromAddress.lastIndexOf('@') + 1).toLowerCase();
  ctx.db
    .update(applications)
    .set({
      lastEmailAt: email.receivedAt > (app.lastEmailAt ?? '') ? email.receivedAt : app.lastEmailAt,
      senderDomains: app.senderDomains.includes(dom) ? app.senderDomains : [...app.senderDomains, dom],
      updatedAt: new Date().toISOString(),
    })
    .where(eq(applications.id, applicationId))
    .run();
  ctx.db.update(emails).set({ applicationId, matchConfidence, reviewStatus: actor === 'user' ? 'assigned' : 'auto' }).where(eq(emails.id, emailId)).run();
  const from = app.status as ApplicationStatus;
  let newStatus: ApplicationStatus | undefined;
  if (target && target !== from && canTransition(from, target, actor)) {
    setApplicationStatus(ctx.db, applicationId, target, actor, `Email from ${email.fromAddress}: "${email.subject.slice(0, 120)}"`, { emailId });
    newStatus = target;
    const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
    const s = getSettings(ctx.db);
    if (target === 'interview' && s.notifications.interviews) {
      notify(ctx, { kind: 'interview', title: `Interview invitation: ${job.company}`, body: `${job.title} — "${email.subject}"`, link: `/jobs/${applicationId}`, urgent: true });
    } else if (target === 'offer') {
      notify(ctx, { kind: 'offer', title: `Offer from ${job.company}`, body: job.title, link: `/jobs/${applicationId}`, urgent: true });
    }
    // Rejections are reported in the daily digest, not individually (spec §5.8).
  } else {
    addEvent(ctx.db, { applicationId, actor, type: 'email_linked', message: `Email: "${email.subject.slice(0, 120)}"`, details: { emailId, classification: cls } });
  }
  ctx.bus.invalidate(`application:${applicationId}`, 'board', 'inbox', 'review', 'summary');
  return { emailId, providerMessageId: '', classification: cls, confidence: null, applicationId, action: newStatus ? 'status_changed' : 'linked', newStatus };
}

/** Job alerts (LinkedIn and boards) feed the scanning pipeline (spec §5.5 step 5, §2.3). */
async function ingestAlert(ctx: AppContext, email: RawEmail): Promise<number> {
  let items = parseLinkedInAlert(email).map((j) => ({ ...j, description: '' }));
  if (items.length === 0) {
    const r = await runTask(ctx, alertParseTask, { from: email.fromAddress, subject: email.subject, text: email.text.slice(0, 12_000) });
    if (!r.ok) return 0;
    items = r.output.jobs.map((j, n) => ({
      title: j.title,
      company: j.company,
      location: j.location ?? '',
      url: j.url ?? `https://alerts.jobhunter.invalid/${encodeURIComponent(email.providerMessageId)}/${n}`,
      sourceJobId: `${email.providerMessageId}:${n}`,
      description: '',
    }));
  }
  const src =
    ctx.db.select().from(sources).where(eq(sources.kind, 'email_alert')).get() ??
    ctx.db.insert(sources).values({ kind: 'email_alert', name: 'Job alert emails', config: { kind: 'email_alert' } }).returning().get();
  const { jobs: norm } = normalizeJobs(items);
  const { newIds } = upsertJobs(ctx, norm, { atsType: 'email_alert', sourceId: src.id, companyId: null });
  ctx.db.update(sources).set({ lastSuccessAt: new Date().toISOString(), lastJobCount: norm.length }).where(eq(sources.id, src.id)).run();
  if (newIds.length) {
    const { shown } = await matchJobs(ctx, newIds);
    promoteMatches(ctx, shown);
  }
  return newIds.length;
}

/** Spec §5.5: after N days without any reply, an application becomes "no response". */
export function applyNoResponseRule(ctx: AppContext, now = new Date()): number[] {
  const days = getSettings(ctx.db).noResponseAfterDays;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const stale = ctx.db
    .select()
    .from(applications)
    .where(inArray(applications.status, ['applied']))
    .all()
    .filter((a) => a.appliedAt && a.appliedAt < cutoff && (!a.lastEmailAt || a.lastEmailAt < cutoff || a.lastEmailAt <= a.appliedAt));
  for (const a of stale) setApplicationStatus(ctx.db, a.id, 'no_response', 'system', `No reply ${days} days after applying`);
  if (stale.length) ctx.bus.invalidate('board', 'summary');
  return stale.map((a) => a.id);
}
