import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ApplicationStatusSchema,
  SearchProfileSchema,
  columnForStatus,
  type BoardCard,
} from '@jobhunter/shared';
import {
  applications,
  companies,
  desc,
  eq,
  getSearchProfile,
  getSettings,
  jobs,
  matches,
  saveSearchProfile,
  setApplicationStatus,
  sources,
  TransitionError,
  addEvent,
  isNull,
} from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { HttpError, notFound, parse } from '../server/http.js';
import { registerJob } from '../scheduler.js';
import { addCompany } from './companies.js';
import { isScanRunning, matchJobs, promoteMatches, runScan } from './pipeline.js';
import { applyProposal, listMessages, rejectProposal, sendMessage } from '../chat/service.js';

registerJob({
  name: 'scan',
  schedule: (ctx) => {
    const s = getSettings(ctx.db);
    return s.scan.enabled ? { kind: 'daily', time: s.scan.time } : { kind: 'off' };
  },
  run: (ctx, trigger) => runScan(ctx, trigger),
});

const Id = z.object({ id: z.coerce.number().int().positive() });

function tagFor(status: string, daysInStatus: number, isNew: boolean): { tag: string; kind: BoardCard['tagKind'] } {
  if (status === 'found') return isNew ? { tag: 'new', kind: 'new' } : { tag: `found:${daysInStatus}`, kind: 'muted' };
  if (status === 'drafting') return { tag: 'drafting', kind: 'info' };
  if (status === 'ready') return { tag: 'awaiting_approval', kind: 'warn' };
  if (status === 'applied') return { tag: `waiting:${daysInStatus}`, kind: 'muted' };
  if (status === 'interview' || status === 'assessment' || status === 'offer') return { tag: status, kind: 'warn' };
  return { tag: status, kind: 'muted' };
}

export function boardCards(ctx: AppContext): BoardCard[] {
  const rows = ctx.db
    .select({ app: applications, job: jobs, score: matches.score })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(matches, eq(matches.jobId, jobs.id))
    .orderBy(desc(applications.updatedAt))
    .all();
  const now = Date.now();
  return rows
    .filter((r) => columnForStatus(r.app.status as never) !== null)
    .map((r) => {
      const days = Math.floor((now - Date.parse(r.app.statusChangedAt)) / 86_400_000);
      const isNew = now - Date.parse(r.job.firstSeenAt) < 36 * 3600_000;
      const { tag, kind } = tagFor(r.app.status, days, isNew);
      return {
        applicationId: r.app.id,
        jobId: r.job.id,
        company: r.job.company,
        title: r.job.title,
        location: r.job.location,
        remote: r.job.remote as BoardCard['remote'],
        source: r.job.atsType,
        score: r.score,
        status: r.app.status as BoardCard['status'],
        tag,
        tagKind: kind,
        updatedAt: r.app.updatedAt,
        firstSeenAt: r.job.firstSeenAt,
        appliedAt: r.app.appliedAt,
      };
    });
}

export function registerScanRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/board', async () => boardCards(ctx));

  app.patch('/api/applications/:id/status', async (req) => {
    const { id } = parse(Id, req.params);
    const { status } = parse(z.object({ status: ApplicationStatusSchema }), req.body);
    try {
      const r = setApplicationStatus(ctx.db, id, status, 'user', `Moved to ${status} by you`);
      ctx.bus.invalidate('board', 'summary', `application:${id}`);
      if (status === 'shortlisted' && r.changed) ctx.bus.emit('applications:shortlisted', [id]);
      return { ok: true };
    } catch (err) {
      if (err instanceof TransitionError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  app.patch('/api/applications/:id/notes', async (req) => {
    const { id } = parse(Id, req.params);
    const { notes } = parse(z.object({ notes: z.string().max(20_000) }), req.body);
    ctx.db.update(applications).set({ notes, updatedAt: new Date().toISOString() }).where(eq(applications.id, id)).run();
    ctx.bus.invalidate(`application:${id}`);
    return { ok: true };
  });

  // Manually add a posting by URL (e.g. one the user found themselves).
  app.post('/api/jobs/manual', async (req) => {
    const body = parse(z.object({ title: z.string().min(2), company: z.string().min(1), url: z.string().url(), location: z.string().default(''), description: z.string().default('') }), req.body);
    const { normalizeJobs } = await import('@jobhunter/mcp-jobs');
    const { upsertJobs } = await import('./pipeline.js');
    const { jobs: norm } = normalizeJobs([{ sourceJobId: body.url, ...body }]);
    const res = upsertJobs(ctx, norm, { atsType: 'generic', sourceId: null, companyId: null });
    const jobId = res.newIds[0] ?? res.seenIds[0]!;
    await matchJobs(ctx, [jobId], { force: true });
    const existing = ctx.db.select().from(applications).where(eq(applications.jobId, jobId)).get();
    const appId = existing?.id ?? ctx.db.insert(applications).values({ jobId, status: 'found' }).returning({ id: applications.id }).get().id;
    if (!existing) addEvent(ctx.db, { applicationId: appId, actor: 'user', type: 'found', message: 'Added by you' });
    ctx.bus.invalidate('board', 'summary');
    return { applicationId: appId };
  });

  // Scanning
  app.post('/api/scan', async (req) => {
    const body = parse(z.object({ sourceIds: z.array(z.number()).optional() }), req.body ?? {});
    void runScan(ctx, 'manual', body).catch((err: unknown) => ctx.log.error({ err }, 'scan failed'));
    return { started: true };
  });
  app.get('/api/scan/status', async () => ({ running: isScanRunning(), nextScanAt: ctx.runtime.nextScanAt }));
  app.post('/api/matches/rescore', async () => {
    const ids = ctx.db.select({ id: jobs.id }).from(jobs).where(isNull(jobs.closedAt)).all().map((r) => r.id);
    void matchJobs(ctx, ids, { force: true }).then(({ shown }) => {
      promoteMatches(ctx, shown);
      ctx.bus.invalidate('board');
    });
    return { started: true, jobs: ids.length };
  });

  // Search profile
  app.get('/api/search-profile', async () => getSearchProfile(ctx.db));
  app.put('/api/search-profile', async (req) => {
    const data = parse(SearchProfileSchema, req.body);
    const version = saveSearchProfile(ctx.db, data);
    ctx.bus.invalidate('search-profile');
    return { version };
  });

  // Companies and sources
  app.get('/api/companies', async () => {
    const list = ctx.db.select().from(companies).orderBy(companies.name).all();
    const srcs = ctx.db.select().from(sources).all();
    return list.map((c) => ({ ...c, sources: srcs.filter((s) => s.companyId === c.id) }));
  });
  app.post('/api/companies', async (req) => {
    const body = parse(z.object({ name: z.string().min(1).max(200).optional(), careersUrl: z.string().url().optional() }).refine((b) => b.name || b.careersUrl, 'Name or careers URL required'), req.body);
    return addCompany(ctx, body);
  });
  app.patch('/api/companies/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ watchStatus: z.enum(['watching', 'suggested', 'rejected', 'paused']) }), req.body);
    ctx.db.update(companies).set({ watchStatus: body.watchStatus }).where(eq(companies.id, id)).run();
    ctx.db.update(sources).set({ enabled: body.watchStatus === 'watching' }).where(eq(sources.companyId, id)).run();
    if (body.watchStatus === 'watching') {
      const c = ctx.db.select().from(companies).where(eq(companies.id, id)).get();
      const hasSource = ctx.db.select().from(sources).where(eq(sources.companyId, id)).all().length > 0;
      if (c && !hasSource) await addCompany(ctx, { name: c.name, careersUrl: c.careersUrl ?? undefined });
    }
    ctx.bus.invalidate('companies', 'sources');
    return { ok: true };
  });
  app.delete('/api/companies/:id', async (req) => {
    const { id } = parse(Id, req.params);
    ctx.db.delete(companies).where(eq(companies.id, id)).run();
    ctx.bus.invalidate('companies', 'sources');
    return { ok: true };
  });
  app.get('/api/sources', async () => ctx.db.select().from(sources).all());
  app.post('/api/sources', async (req) => {
    const body = parse(
      z.object({
        kind: z.enum(['rss', 'arbeitnow', 'generic', 'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'workday']),
        name: z.string().min(1).max(200),
        url: z.string().url().optional(),
        slug: z.string().optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    const id = ctx.db
      .insert(sources)
      .values({ kind: body.kind, name: body.name, config: { kind: body.kind, url: body.url, slug: body.slug, options: body.options ?? {} } })
      .returning({ id: sources.id })
      .get().id;
    ctx.bus.invalidate('sources', 'diagnostics');
    return { id };
  });
  app.patch('/api/sources/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ enabled: z.boolean() }), req.body);
    ctx.db.update(sources).set({ enabled: body.enabled }).where(eq(sources.id, id)).run();
    ctx.bus.invalidate('sources', 'diagnostics');
    return { ok: true };
  });
  app.delete('/api/sources/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const s = ctx.db.select().from(sources).where(eq(sources.id, id)).get();
    if (!s) notFound();
    ctx.db.delete(sources).where(eq(sources.id, id)).run();
    ctx.bus.invalidate('sources', 'diagnostics');
    return { ok: true };
  });

  // Chat (spec §5.7.9): answers questions, proposes changes as diffs
  app.get('/api/chat', async (req) => {
    const { thread } = parse(z.object({ thread: z.string().max(64).default('global') }), req.query);
    return listMessages(ctx, thread);
  });
  app.post('/api/chat', async (req) => {
    const body = parse(z.object({ thread: z.string().max(64).default('global'), content: z.string().min(1).max(4000) }), req.body);
    return sendMessage(ctx, body.thread, body.content);
  });
  app.post('/api/chat/proposals/:id/apply', async (req) => {
    const { id } = parse(Id, req.params);
    try {
      await applyProposal(ctx, id);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return { ok: true };
  });
  app.post('/api/chat/proposals/:id/reject', async (req) => {
    const { id } = parse(Id, req.params);
    rejectProposal(ctx, id);
    return { ok: true };
  });
}
