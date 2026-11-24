import {
  addEvent,
  and,
  applications,
  asc,
  desc,
  eq,
  events,
  inArray,
  jobs,
  like,
  matches,
  or,
  setApplicationStatus,
  type Db,
} from '@jobhunter/db';
import { APPLICATION_STATUSES, BOARD_COLUMNS, columnForStatus, type ApplicationStatus } from '@jobhunter/shared';

/**
 * Pipeline tools as plain typed functions over the database (spec §3.2: agents and the UI never write
 * SQL directly). Used by the MCP server in this package; the same functions can back in-process tools.
 */

export interface ApplicationSummary {
  id: number;
  status: ApplicationStatus;
  column: string | null;
  company: string;
  title: string;
  location: string;
  score: number | null;
  appliedAt: string | null;
  statusChangedAt: string;
  url: string;
}

function summaryRows(db: Db, where: ReturnType<typeof and>, limit = 50): ApplicationSummary[] {
  const q = db
    .select({ app: applications, job: jobs, score: matches.score })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(matches, eq(matches.jobId, jobs.id));
  return (where ? q.where(where) : q)
    .orderBy(desc(applications.statusChangedAt))
    .limit(limit)
    .all()
    .map(({ app, job, score }) => ({
      id: app.id,
      status: app.status as ApplicationStatus,
      column: columnForStatus(app.status as ApplicationStatus),
      company: job.company,
      title: job.title,
      location: job.location,
      score: score ?? null,
      appliedAt: app.appliedAt,
      statusChangedAt: app.statusChangedAt,
      url: job.url,
    }));
}

/** Counts per board column and per status. */
export function pipelineSummary(db: Db): { columns: Record<string, number>; statuses: Partial<Record<ApplicationStatus, number>>; total: number } {
  const rows = db.select({ status: applications.status }).from(applications).all();
  const statuses: Partial<Record<ApplicationStatus, number>> = {};
  const columns: Record<string, number> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, 0]));
  for (const r of rows) {
    const s = r.status as ApplicationStatus;
    statuses[s] = (statuses[s] ?? 0) + 1;
    const col = columnForStatus(s);
    if (col) columns[col] = (columns[col] ?? 0) + 1;
  }
  return { columns, statuses, total: rows.length };
}

export function listApplications(db: Db, opts: { statuses?: ApplicationStatus[]; query?: string; limit?: number } = {}): ApplicationSummary[] {
  const conds = [];
  if (opts.statuses?.length) conds.push(inArray(applications.status, opts.statuses));
  if (opts.query?.trim()) {
    const q = `%${opts.query.trim().replace(/[%_]/gu, '')}%`;
    conds.push(or(like(jobs.title, q), like(jobs.company, q), like(jobs.location, q)));
  }
  return summaryRows(db, conds.length ? and(...conds) : undefined, Math.min(opts.limit ?? 50, 200));
}

export interface ApplicationDetail extends ApplicationSummary {
  notes: string;
  description: string;
  matchReasons: string[];
  matchGaps: string[];
  timeline: { at: string; actor: string; type: string; message: string }[];
}

export function getApplication(db: Db, id: number): ApplicationDetail | null {
  const [summary] = summaryRows(db, eq(applications.id, id), 1);
  if (!summary) return null;
  const app = db.select().from(applications).where(eq(applications.id, id)).get()!;
  const job = db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const match = db.select().from(matches).where(eq(matches.jobId, job.id)).get();
  const timeline = db
    .select()
    .from(events)
    .where(eq(events.applicationId, id))
    .orderBy(asc(events.createdAt))
    .all()
    .map((e) => ({ at: e.createdAt, actor: e.actor, type: e.type, message: e.message }));
  return {
    ...summary,
    notes: app.notes,
    // Postings can be long; the first part is enough for questions about the role.
    description: job.description.slice(0, 4000),
    matchReasons: match?.reasons ?? [],
    matchGaps: match?.gaps ?? [],
    timeline,
  };
}

/** Changes a status through the state machine, as the agent (so e.g. "applied" stays the user's call). */
export function updateStatus(db: Db, id: number, to: ApplicationStatus, reason: string): { ok: boolean; from?: ApplicationStatus; error?: string } {
  try {
    const r = setApplicationStatus(db, id, to, 'agent', reason || `Status set to ${to} via MCP`, { via: 'mcp' });
    return { ok: true, from: r.from };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function addNote(db: Db, id: number, text: string): { ok: boolean; error?: string } {
  const app = db.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) return { ok: false, error: `Application ${id} not found` };
  const notes = app.notes ? `${app.notes}\n\n${text}` : text;
  db.update(applications).set({ notes, updatedAt: new Date().toISOString() }).where(eq(applications.id, id)).run();
  addEvent(db, { applicationId: id, actor: 'agent', type: 'note', message: text.slice(0, 500) });
  return { ok: true };
}

export const STATUSES = APPLICATION_STATUSES;
