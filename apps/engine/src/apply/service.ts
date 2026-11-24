import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { z } from 'zod';
import {
  addEvent,
  and,
  applications,
  applyRuns,
  eq,
  events,
  getProfile,
  getSettings,
  gte,
  jobs,
  matches,
  setApplicationStatus,
  sql,
} from '@jobhunter/db';
import {
  BrowserSession,
  canAutoSubmit,
  prepareApplication,
  submitApplication,
  type ApplyData,
  type FieldValue,
  type FormField,
  type PrepareResult,
} from '@jobhunter/mcp-browser';
import { domainOf, effectiveExclusions, registrableDomain, type CoverLetter, type FormAnswer } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { HttpError, notFound, parse } from '../server/http.js';
import { notify } from '../notify.js';
import { runTask } from '../agent/runner.js';
import { formFillTask } from '../tasks/apply.js';
import { currentDocuments, isPackageApproved } from '../documents/service.js';
import { registerService } from '../services.js';

const sessions = new WeakMap<AppContext, BrowserSession>();

export function browserSession(ctx: AppContext): BrowserSession {
  let s = sessions.get(ctx);
  if (!s) {
    s = new BrowserSession(ctx.config.browserProfileDir, ctx.config.headlessBrowser);
    sessions.set(ctx, s);
  }
  return s;
}

/** Closes the application browser (if open) so its profile folder can be removed. */
export async function closeBrowserSession(ctx: AppContext): Promise<void> {
  const s = sessions.get(ctx);
  sessions.delete(ctx);
  await s?.close();
}

registerService({ name: 'browser', start: () => undefined, stop: closeBrowserSession });

function applyData(ctx: AppContext, appId: number): ApplyData {
  const p = getProfile(ctx.db).data;
  const docs = currentDocuments(ctx, appId);
  const parts = p.basics.name.trim().split(/\s+/u);
  const letter = docs.cover_letter?.content as CoverLetter | undefined;
  const current = p.work.find((w) => !w.endDate);
  return {
    firstName: parts.slice(0, -1).join(' ') || parts[0] || '',
    lastName: parts.length > 1 ? parts.at(-1)! : '',
    email: p.basics.email ?? '',
    phone: p.basics.phone ?? null,
    city: p.basics.location?.city ?? null,
    linkedin: p.basics.profiles.find((x) => /linkedin/iu.test(x.network) || /linkedin/iu.test(x.url))?.url ?? null,
    website: p.basics.url ?? null,
    currentCompany: current?.name ?? null,
    cvPath: docs.cv?.pdfPath ?? null,
    letterPath: docs.cover_letter?.pdfPath ?? null,
    letterText: letter ? [letter.greeting, ...letter.paragraphs.map((x) => x.text), letter.closing, p.basics.name].join('\n\n') : null,
    answers: (docs.form_answers?.content as FormAnswer[] | undefined) ?? [],
  };
}

function submittedToday(ctx: AppContext): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return (
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(applyRuns)
      .where(and(eq(applyRuns.status, 'submitted'), gte(applyRuns.finishedAt, start.toISOString())))
      .get()?.n ?? 0
  );
}

function modelMapper(ctx: AppContext, appId: number, job: { company: string; title: string }, answers: FormAnswer[]) {
  return async (fields: FormField[]): Promise<Map<string, FieldValue>> => {
    const usable = answers.map((a, index) => ({ index, question: a.question, answer: a.answer })).filter((a) => a.answer.trim());
    const out = new Map<string, FieldValue>();
    const candidates = fields.filter((f) => f.kind !== 'file' && f.kind !== 'checkbox' && f.kind !== 'password');
    if (!usable.length || !candidates.length) return out;
    const r = await runTask(
      ctx,
      formFillTask,
      { company: job.company, title: job.title, fields: candidates.map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options, required: f.required })), answers: usable },
      { applicationId: appId },
    );
    if (!r.ok) return out;
    for (const m of r.output.mappings) {
      if (m.value === null || m.answerIndex === null) continue;
      const f = candidates.find((x) => x.id === m.fieldId);
      if (!f) continue;
      out.set(f.id, f.options.length ? { kind: 'option', value: m.value, source: `answer#${m.answerIndex}` } : { kind: 'text', value: m.value, source: `answer#${m.answerIndex}` });
    }
    return out;
  };
}

const running = new Set<number>();

/**
 * Apply flow (spec §5.6). Level "prepare" (default) fills the form and stops before submit; level
 * "submit" submits only when every policy condition holds, otherwise it falls back to "prepare".
 */
export async function startApply(ctx: AppContext, appId: number): Promise<number> {
  const app = ctx.db.select().from(applications).where(eq(applications.id, appId)).get();
  if (!app) throw new HttpError(404, 'Application not found');
  if (running.has(appId)) throw new HttpError(409, 'Already applying');
  const settings = getSettings(ctx.db);
  if (settings.autoApply.level === 'off') throw new HttpError(400, 'Auto-apply is off. Use "Apply myself".');
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const url = job.applyUrl ?? job.url;
  const level = settings.autoApply.level === 'submit' ? 'submit' : 'prepare';
  const run = ctx.db.insert(applyRuns).values({ applicationId: appId, level, status: 'running', url }).returning({ id: applyRuns.id }).get();
  running.add(appId);
  void doApply(ctx, run.id, appId, url).finally(() => running.delete(appId));
  ctx.bus.invalidate(`application:${appId}`);
  return run.id;
}

async function doApply(ctx: AppContext, runId: number, appId: number, url: string): Promise<void> {
  const settings = getSettings(ctx.db);
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, ctx.db.select().from(applications).where(eq(applications.id, appId)).get()!.jobId)).get()!;
  const host = domainOf(url) ?? '';
  const dir = join(ctx.config.filesDir, 'applications', String(appId));
  mkdirSync(dir, { recursive: true });
  const finish = (status: string, stopReason: string | null, prep: PrepareResult | null, screenshotPath: string | null) => {
    ctx.db
      .update(applyRuns)
      .set({ status, stopReason, fields: prep?.fields ?? null, screenshotPath, url: prep?.url ?? url, finishedAt: new Date().toISOString(), filler: 'rules+model' })
      .where(eq(applyRuns.id, runId))
      .run();
    ctx.bus.invalidate(`application:${appId}`, 'approvals', 'summary', 'board');
  };
  const exclusions = effectiveExclusions(settings);
  if (exclusions.some((d) => host === d || host.endsWith(`.${d}`))) {
    addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'apply_stopped', message: `Not applying automatically on ${host} (excluded site). Use "Apply myself".` });
    finish('handover', 'excluded_site', null, null);
    return;
  }
  if (!isPackageApproved(ctx, appId) && !settings.autoApply.autoApprovePackages) {
    finish('handover', 'not_approved', null, null);
    addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'apply_stopped', message: 'Approve the application package first.' });
    return;
  }
  const session = browserSession(ctx);
  const page = await session.newPage();
  let keepOpen = false;
  try {
    const data = applyData(ctx, appId);
    const prep = await prepareApplication(page, { url, data, mapUnresolved: modelMapper(ctx, appId, job, data.answers) });
    const shot = join(dir, `run-${runId}-prepared.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    const match = ctx.db.select().from(matches).where(eq(matches.jobId, job.id)).get();
    const decision = canAutoSubmit({
      level: settings.autoApply.level,
      score: match?.score ?? null,
      minScore: settings.autoApply.minScore,
      packageApproved: isPackageApproved(ctx, appId),
      autoApprovePackages: settings.autoApply.autoApprovePackages,
      host,
      excludedDomains: exclusions,
      submittedToday: submittedToday(ctx),
      dailyCap: settings.autoApply.dailyCap,
      blocker: prep.blocker ?? (prep.readyToSubmit ? null : 'unexpected'),
      unresolvedRequired: prep.unresolvedRequired.length,
    });
    if (decision.submit) {
      const s = await submitApplication(page);
      const done = join(dir, `run-${runId}-submitted.png`);
      await page.screenshot({ path: done, fullPage: true }).catch(() => undefined);
      if (s.submitted) {
        const text = await page.locator('body').innerText().catch(() => '');
        const ref = /(?:reference|referenz|référence|referencia|referência)(?:\s*(?:id|number|nr\.?|no\.?))?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/iu.exec(text)?.[1];
        recordApplied(ctx, appId, 'agent', host, [job.atsJobId, ref].filter((x): x is string => !!x), true);
        addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'submitted', message: `Application submitted automatically on ${host}`, screenshotPath: done, details: { runId } });
        finish('submitted', null, prep, done);
        return;
      }
      finish('handover', s.blocker ?? 'unexpected', prep, done);
      addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'apply_stopped', message: `Submission stopped (${s.blocker ?? 'unexpected'}); please finish it yourself.`, screenshotPath: done });
      notify(ctx, { kind: 'handover', title: `Finish your application: ${job.company}`, body: `The form stopped at "${s.blocker ?? 'unexpected'}".`, link: `/jobs/${appId}`, urgent: true });
      keepOpen = !ctx.config.headlessBrowser;
      return;
    }
    const stop = prep.blocker ?? (prep.unresolvedRequired.length ? 'unknown_fields' : prep.readyToSubmit ? null : 'unexpected');
    const status = prep.blocker ? 'handover' : 'prepared';
    finish(status, stop, prep, shot);
    addEvent(ctx.db, {
      applicationId: appId,
      actor: 'agent',
      type: status === 'prepared' ? 'form_prepared' : 'apply_stopped',
      message:
        status === 'prepared'
          ? `Form filled on ${host}${prep.unresolvedRequired.length ? `; ${prep.unresolvedRequired.length} required field(s) need you` : ''}. Review it and submit yourself.`
          : `Stopped on ${host}: ${stop}. Please continue yourself.`,
      screenshotPath: shot,
      details: { runId, unresolved: prep.unresolvedRequired.map((f) => f.label) },
    });
    notify(ctx, {
      kind: 'handover',
      title: status === 'prepared' ? `Form ready to review: ${job.company}` : `Your help is needed: ${job.company}`,
      body: status === 'prepared' ? 'Check the prefilled form and submit it yourself.' : `Stopped at: ${stop}.`,
      link: `/jobs/${appId}`,
    });
    // Desktop: leave the filled form open in the app's browser for the user to submit.
    keepOpen = !ctx.config.headlessBrowser;
  } catch (err) {
    ctx.log.error({ err }, 'apply failed');
    finish('failed', 'unexpected', null, null);
    addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'apply_failed', message: `Applying failed: ${(err as Error).message.slice(0, 300)}` });
  } finally {
    if (!keepOpen) await page.close().catch(() => undefined);
  }
}

/** Mark an application as applied and remember who will email back (spec §5.6 "After submitting"). */
export function recordApplied(ctx: AppContext, appId: number, actor: 'agent' | 'user', host: string | null, refs: string[], auto: boolean): void {
  const app = ctx.db.select().from(applications).where(eq(applications.id, appId)).get()!;
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const domains = new Set(app.senderDomains);
  if (host) domains.add(registrableDomain(host));
  const jobHost = domainOf(job.url);
  if (jobHost) domains.add(registrableDomain(jobHost));
  ctx.db
    .update(applications)
    .set({ senderDomains: [...domains], atsRefIds: [...new Set([...app.atsRefIds, ...refs])], channel: actor === 'agent' ? 'agent' : 'manual', autoSubmitted: auto })
    .where(eq(applications.id, appId))
    .run();
  if (app.status !== 'applied') setApplicationStatus(ctx.db, appId, 'applied', actor === 'agent' ? 'agent' : 'user', actor === 'agent' ? 'Applied by the agent' : 'You marked this as applied');
  ctx.bus.invalidate(`application:${appId}`, 'board', 'summary');
}

export function registerApplyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const Id = z.object({ id: z.coerce.number().int().positive() });

  app.post('/api/applications/:id/apply', async (req) => {
    const { id } = parse(Id, req.params);
    return { runId: await startApply(ctx, id) };
  });

  app.post('/api/applications/:id/mark-applied', async (req) => {
    const { id } = parse(Id, req.params);
    const a = ctx.db.select().from(applications).where(eq(applications.id, id)).get();
    if (!a) notFound();
    const run = ctx.db.select().from(applyRuns).where(eq(applyRuns.applicationId, id)).all().at(-1);
    recordApplied(ctx, id, 'user', run?.url ? domainOf(run.url) : null, [], false);
    if (run && run.status !== 'submitted') ctx.db.update(applyRuns).set({ status: 'submitted', finishedAt: new Date().toISOString() }).where(eq(applyRuns.id, run.id)).run();
    return { ok: true };
  });

  app.get('/api/apply-runs/:id/screenshot', async (req, reply) => {
    const { id } = parse(Id, req.params);
    const r = ctx.db.select().from(applyRuns).where(eq(applyRuns.id, id)).get();
    if (!r?.screenshotPath || !existsSync(r.screenshotPath)) notFound();
    return reply.type('image/png').send(createReadStream(r.screenshotPath));
  });

  app.get('/api/events/:id/screenshot', async (req, reply) => {
    const { id } = parse(Id, req.params);
    const e = ctx.db.select().from(events).where(eq(events.id, id)).get();
    if (!e?.screenshotPath || !existsSync(e.screenshotPath)) notFound();
    return reply.type('image/png').send(createReadStream(e.screenshotPath));
  });

  // Let the user log in to a portal themselves in the app's browser (desktop). Jobhunter never types passwords.
  app.post('/api/browser/open', async (req) => {
    const { url } = parse(z.object({ url: z.string().url() }), req.body);
    if (ctx.config.headlessBrowser) throw new HttpError(400, 'The browser is headless in server mode; log in on your own device instead.');
    await browserSession(ctx).openForUser(url);
    return { ok: true };
  });
}
