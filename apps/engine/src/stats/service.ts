import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applications, emails, eq, events, getSearchProfile, isNotNull, jobs, sources, taskRuns } from '@jobhunter/db';
import { normalizeTitle, similarity } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { parse } from '../server/http.js';

/** Statuses that mean "the employer answered". */
const REPLY = new Set(['interview', 'assessment', 'offer', 'rejected']);
const INTERVIEW = new Set(['interview', 'assessment', 'offer']);
const APPLIED = new Set(['applied', 'interview', 'assessment', 'offer', 'rejected', 'no_response']);
const SHORTLISTED = new Set(['shortlisted', 'drafting', 'ready', ...APPLIED]);

export interface GroupRow {
  key: string;
  applied: number;
  replied: number;
  interviews: number;
  offers: number;
}

export interface Stats {
  since: string | null;
  funnel: { found: number; shortlisted: number; applied: number; replied: number; interviews: number; offers: number };
  medianDaysToFirstReply: number | null;
  repliesMeasured: number;
  bySource: GroupRow[];
  byRole: GroupRow[];
  costByTask: { task: string; runs: number; failed: number; costUsd: number }[];
  costByMonth: { month: string; costUsd: number }[];
  totalCostUsd: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Puts a job title into the closest of the user's target roles, or "other". */
export function roleBucket(title: string, roles: string[]): string {
  const t = normalizeTitle(title);
  let best = { role: 'other', score: 0 };
  for (const r of roles) {
    const n = normalizeTitle(r);
    const score = n && t.includes(n) ? 1 : similarity(t, n);
    if (score > best.score) best = { role: r, score };
  }
  return best.score >= 0.5 ? best.role : 'other';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Application statistics (spec §5.9): funnel, rates by source and role, time to first reply, model cost. */
export function computeStats(ctx: AppContext, since: Date | null = null): Stats {
  const sinceIso = since?.toISOString() ?? null;
  const roles = getSearchProfile(ctx.db).data.roles;
  const apps = ctx.db
    .select({
      id: applications.id,
      status: applications.status,
      appliedAt: applications.appliedAt,
      createdAt: applications.createdAt,
      title: jobs.title,
      atsType: jobs.atsType,
      sourceKind: sources.kind,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(sources, eq(sources.id, jobs.sourceId))
    .all()
    .filter((a) => !sinceIso || a.createdAt >= sinceIso);

  // Every status an application has been in, with the first time it got there.
  const history = new Map<number, Map<string, string>>();
  for (const e of ctx.db.select().from(events).where(eq(events.type, 'status_changed')).all()) {
    if (!e.applicationId) continue;
    const to = (e.details as { to?: string } | null)?.to;
    if (!to) continue;
    const h = history.get(e.applicationId) ?? new Map<string, string>();
    if (!h.has(to) || e.createdAt < h.get(to)!) h.set(to, e.createdAt);
    history.set(e.applicationId, h);
  }
  const firstEmail = new Map<number, string[]>();
  for (const m of ctx.db.select({ applicationId: emails.applicationId, receivedAt: emails.receivedAt }).from(emails).where(isNotNull(emails.applicationId)).all()) {
    const list = firstEmail.get(m.applicationId!) ?? [];
    list.push(m.receivedAt);
    firstEmail.set(m.applicationId!, list);
  }

  const reached = (a: (typeof apps)[number], set: Set<string>) => set.has(a.status) || [...(history.get(a.id)?.keys() ?? [])].some((s) => set.has(s));
  const funnel = { found: apps.length, shortlisted: 0, applied: 0, replied: 0, interviews: 0, offers: 0 };
  const groups = { source: new Map<string, GroupRow>(), role: new Map<string, GroupRow>() };
  const replyDays: number[] = [];
  const row = (m: Map<string, GroupRow>, key: string) => {
    let r = m.get(key);
    if (!r) m.set(key, (r = { key, applied: 0, replied: 0, interviews: 0, offers: 0 }));
    return r;
  };

  for (const a of apps) {
    if (reached(a, SHORTLISTED)) funnel.shortlisted++;
    const applied = !!a.appliedAt || reached(a, APPLIED);
    if (!applied) continue;
    funnel.applied++;
    const appliedAt = a.appliedAt ?? history.get(a.id)?.get('applied') ?? null;
    const replyTimes = [
      ...(firstEmail.get(a.id) ?? []).filter((t) => !appliedAt || t > appliedAt),
      ...[...(history.get(a.id)?.entries() ?? [])].filter(([s]) => REPLY.has(s)).map(([, t]) => t),
    ].sort();
    const replied = replyTimes.length > 0 || reached(a, REPLY);
    const interview = reached(a, INTERVIEW);
    const offer = reached(a, new Set(['offer']));
    if (replied) funnel.replied++;
    if (interview) funnel.interviews++;
    if (offer) funnel.offers++;
    if (appliedAt && replyTimes[0]) replyDays.push((Date.parse(replyTimes[0]) - Date.parse(appliedAt)) / 86_400_000);
    for (const r of [row(groups.source, a.sourceKind ?? a.atsType ?? 'manual'), row(groups.role, roleBucket(a.title, roles))]) {
      r.applied++;
      if (replied) r.replied++;
      if (interview) r.interviews++;
      if (offer) r.offers++;
    }
  }

  const runs = ctx.db.select({ task: taskRuns.task, status: taskRuns.status, costUsd: taskRuns.costUsd, startedAt: taskRuns.startedAt }).from(taskRuns).all().filter((r) => !sinceIso || r.startedAt >= sinceIso);
  const byTask = new Map<string, { task: string; runs: number; failed: number; costUsd: number }>();
  const byMonth = new Map<string, number>();
  for (const r of runs) {
    if (r.status === 'skipped') continue;
    const t = byTask.get(r.task) ?? { task: r.task, runs: 0, failed: 0, costUsd: 0 };
    t.runs++;
    if (r.status === 'failed') t.failed++;
    t.costUsd += r.costUsd;
    byTask.set(r.task, t);
    const month = r.startedAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + r.costUsd);
  }
  const sortRows = (m: Map<string, GroupRow>) => [...m.values()].sort((x, y) => y.applied - x.applied || x.key.localeCompare(y.key));
  const costByTask = [...byTask.values()].map((t) => ({ ...t, costUsd: round2(t.costUsd) })).sort((x, y) => y.costUsd - x.costUsd || y.runs - x.runs);
  const md = median(replyDays.filter((d) => d >= 0));
  return {
    since: sinceIso,
    funnel,
    medianDaysToFirstReply: md === null ? null : Math.round(md * 10) / 10,
    repliesMeasured: replyDays.length,
    bySource: sortRows(groups.source),
    byRole: sortRows(groups.role),
    costByTask,
    costByMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, c]) => ({ month, costUsd: round2(c) })),
    totalCostUsd: round2(runs.reduce((s, r) => s + r.costUsd, 0)),
  };
}

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/stats', async (req) => {
    const q = parse(z.object({ days: z.coerce.number().int().positive().max(3650).optional() }), req.query);
    return computeStats(ctx, q.days ? new Date(Date.now() - q.days * 86_400_000) : null);
  });
}
