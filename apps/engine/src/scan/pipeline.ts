import { createHash } from 'node:crypto';
import {
  ADAPTERS,
  FetchError,
  findDuplicate,
  normalizeJobs,
  type ExistingJobKey,
  type NormalizedJob,
  type PageExtractor,
  type SourceConfig,
} from '@jobhunter/mcp-jobs';
import {
  and,
  applications,
  confirmedFacts,
  eq,
  getProfile,
  getSearchProfile,
  getSettings,
  inArray,
  jobs,
  matches,
  pageExtractions,
  scanRuns,
  setApplicationStatus,
  sources,
  addEvent,
  isNull,
} from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { notify } from '../notify.js';
import { batchSize, batches, runTask } from '../agent/runner.js';
import { jobExtractTask, matchScoreTask } from '../tasks/scan.js';
import { profileSummary } from '../profile/facts.js';
import { PoliteFetcher } from './fetcher.js';
import { prefilter, salaryText } from './matching.js';

export function createFetcher(ctx: AppContext, overrides: Partial<ConstructorParameters<typeof PoliteFetcher>[1]> = {}): PoliteFetcher {
  const s = getSettings(ctx.db);
  return new PoliteFetcher(ctx.db, {
    minIntervalMs: s.scraping.minIntervalMs,
    maxPagesPerDomainPerDay: s.scraping.maxPagesPerDomainPerDay,
    freshMs: 6 * 3600_000,
    ...scanTestOverrides.get(ctx),
    ...overrides,
  });
}

/** Tests inject a fixture-backed fetch implementation and zero delays. */
export const scanTestOverrides = new WeakMap<AppContext, Partial<ConstructorParameters<typeof PoliteFetcher>[1]>>();

/** Model-backed careers page extraction, cached by URL + content hash so unchanged pages cost nothing. */
export function createExtractor(ctx: AppContext): PageExtractor {
  return {
    async extract(page) {
      const hash = createHash('sha256').update(page.text).update(JSON.stringify(page.links)).digest('hex').slice(0, 32);
      const hit = ctx.db
        .select()
        .from(pageExtractions)
        .where(and(eq(pageExtractions.url, page.url), eq(pageExtractions.contentHash, hash)))
        .get();
      if (hit) return hit.result as Awaited<ReturnType<PageExtractor['extract']>>;
      const r = await runTask(ctx, jobExtractTask, page);
      if (!r.ok) throw new Error(`Could not extract jobs from ${page.url}: ${r.error.message}`);
      ctx.db.insert(pageExtractions).values({ url: page.url, contentHash: hash, result: r.output }).onConflictDoNothing().run();
      return r.output;
    },
  };
}

function existingKeys(ctx: AppContext): ExistingJobKey[] {
  return ctx.db
    .select({
      id: jobs.id,
      atsType: jobs.atsType,
      atsJobId: jobs.atsJobId,
      canonicalUrl: jobs.canonicalUrl,
      normCompany: jobs.normCompany,
      normTitle: jobs.normTitle,
      normLocation: jobs.normLocation,
    })
    .from(jobs)
    .all();
}

/**
 * Store normalised postings: update known jobs (last seen, refreshed content), insert new ones.
 * Never creates a duplicate (spec §5.3 acceptance).
 */
export function upsertJobs(
  ctx: AppContext,
  list: NormalizedJob[],
  meta: { atsType: string; sourceId: number | null; companyId: number | null },
): { newIds: number[]; seenIds: number[] } {
  const keys = existingKeys(ctx);
  const newIds: number[] = [];
  const seenIds: number[] = [];
  const now = new Date().toISOString();
  for (const j of list) {
    const dup = findDuplicate({ ...j, atsType: meta.atsType }, keys);
    if (dup !== null) {
      seenIds.push(dup);
      const cur = ctx.db.select({ hash: jobs.contentHash, desc: jobs.description }).from(jobs).where(eq(jobs.id, dup)).get();
      const better = cur && j.description.length > cur.desc.length;
      ctx.db
        .update(jobs)
        .set({ lastSeenAt: now, closedAt: null, ...(better ? { description: j.description, contentHash: j.contentHash } : {}) })
        .where(eq(jobs.id, dup))
        .run();
      continue;
    }
    const row = ctx.db
      .insert(jobs)
      .values({
        sourceId: meta.sourceId,
        companyId: meta.companyId,
        company: j.company,
        normCompany: j.normCompany,
        title: j.title,
        normTitle: j.normTitle,
        location: j.location,
        normLocation: j.normLocation,
        remote: j.remote,
        salary: j.salary,
        language: j.language,
        description: j.description,
        url: j.url,
        canonicalUrl: j.canonicalUrl,
        applyUrl: j.applyUrl,
        atsType: meta.atsType,
        atsJobId: j.sourceJobId,
        department: j.department,
        employmentType: j.employmentType,
        postedAt: j.postedAt,
        contentHash: j.contentHash,
      })
      .returning({ id: jobs.id })
      .get();
    newIds.push(row.id);
    keys.push({ id: row.id, atsType: meta.atsType, atsJobId: j.sourceJobId, canonicalUrl: j.canonicalUrl, normCompany: j.normCompany, normTitle: j.normTitle, normLocation: j.normLocation });
  }
  return { newIds, seenIds };
}

/** Prefilter + model scoring for jobs without a current match. Returns how many reached the threshold. */
export async function matchJobs(ctx: AppContext, jobIds: number[], opts: { force?: boolean } = {}): Promise<{ scored: number; shown: number[] }> {
  if (jobIds.length === 0) return { scored: 0, shown: [] };
  const settings = getSettings(ctx.db);
  const profile = getProfile(ctx.db);
  const search = getSearchProfile(ctx.db);
  const facts = confirmedFacts(ctx.db);
  const rows = ctx.db.select().from(jobs).where(inArray(jobs.id, jobIds)).all();
  const current = new Map(ctx.db.select().from(matches).where(inArray(matches.jobId, jobIds)).all().map((m) => [m.jobId, m]));
  const toScore: typeof rows = [];
  for (const j of rows) {
    const m = current.get(j.id);
    if (!opts.force && m && m.profileVersion === profile.version && m.searchVersion === search.version) continue;
    const pf = prefilter({ ...j, salary: j.salary as Parameters<typeof prefilter>[0]['salary'] }, search.data);
    if (!pf.pass) {
      upsertMatch(ctx, j.id, { score: 0, reasons: [], gaps: [], model: null, prefilterPassed: false, prefilterReason: pf.reason, profileVersion: profile.version, searchVersion: search.version });
      continue;
    }
    toScore.push(j);
  }
  if (facts.length === 0) {
    ctx.log.info({ jobs: toScore.length }, 'skipping match scoring: no confirmed profile facts yet');
    return { scored: 0, shown: [] };
  }
  const candidate = { summary: profileSummary(profile.data), facts: facts.slice(0, 120).map((f) => f.text) };
  let scored = 0;
  const shown: number[] = [];
  for (const batch of batches(toScore, batchSize(settings, 'match_score'))) {
    const r = await runTask(ctx, matchScoreTask, {
      candidate,
      search: search.data,
      jobs: batch.map((j) => ({
        key: String(j.id),
        title: j.title,
        company: j.company,
        location: j.location,
        remote: j.remote,
        salary: salaryText(j.salary as Parameters<typeof salaryText>[0]),
        description: j.description.slice(0, 5000),
      })),
    });
    if (!r.ok) {
      if (r.error.kind === 'budget' || r.error.kind === 'auth' || r.error.kind === 'config') break;
      continue;
    }
    for (const res of r.output.results) {
      const id = Number(res.key);
      upsertMatch(ctx, id, { score: res.score, reasons: res.reasons, gaps: res.gaps, model: r.model, prefilterPassed: true, prefilterReason: null, profileVersion: profile.version, searchVersion: search.version });
      scored++;
      if (res.score >= settings.matchThresholdShow) shown.push(id);
    }
  }
  return { scored, shown };
}

function upsertMatch(
  ctx: AppContext,
  jobId: number,
  m: { score: number; reasons: string[]; gaps: string[]; model: string | null; prefilterPassed: boolean; prefilterReason: string | null; profileVersion: number; searchVersion: number },
) {
  ctx.db
    .insert(matches)
    .values({ jobId, ...m })
    .onConflictDoUpdate({ target: matches.jobId, set: { ...m, createdAt: new Date().toISOString() } })
    .run();
}

/** Put matched jobs on the board ("Found") and optionally auto-shortlist the best ones. */
export function promoteMatches(ctx: AppContext, jobIds: number[]): { created: number[]; shortlisted: number[] } {
  const settings = getSettings(ctx.db);
  const created: number[] = [];
  const shortlisted: number[] = [];
  for (const jobId of jobIds) {
    const existing = ctx.db.select().from(applications).where(eq(applications.jobId, jobId)).get();
    if (existing) continue;
    const app = ctx.db.insert(applications).values({ jobId, status: 'found' }).returning({ id: applications.id }).get();
    created.push(app.id);
    const m = ctx.db.select().from(matches).where(eq(matches.jobId, jobId)).get();
    addEvent(ctx.db, { applicationId: app.id, actor: 'system', type: 'found', message: `Found by the daily scan (match ${m?.score ?? '?'}%)` });
    if (settings.matchThresholdAutoShortlist !== null && m && m.score >= settings.matchThresholdAutoShortlist) {
      setApplicationStatus(ctx.db, app.id, 'shortlisted', 'agent', `Auto-shortlisted (match ${m.score}% ≥ ${settings.matchThresholdAutoShortlist}%)`);
      shortlisted.push(app.id);
    }
  }
  if (shortlisted.length) ctx.bus.emit('applications:shortlisted', shortlisted);
  return { created, shortlisted };
}

export interface ScanResult {
  runId: number;
  sourcesTotal: number;
  sourcesFailed: number;
  jobsSeen: number;
  jobsNew: number;
  matchesNew: number;
}

let running: Promise<ScanResult> | null = null;

export function isScanRunning(): boolean {
  return running !== null;
}

/** One full scan. Concurrent calls share the running scan. */
export function runScan(ctx: AppContext, trigger: 'schedule' | 'manual' | 'catchup', opts: { sourceIds?: number[] } = {}): Promise<ScanResult> {
  if (running) return running;
  running = doScan(ctx, trigger, opts).finally(() => {
    running = null;
  });
  return running;
}

async function doScan(ctx: AppContext, trigger: 'schedule' | 'manual' | 'catchup', opts: { sourceIds?: number[] }): Promise<ScanResult> {
  const run = ctx.db.insert(scanRuns).values({ trigger, status: 'running' }).returning({ id: scanRuns.id }).get();
  ctx.bus.invalidate('scan', 'diagnostics');
  const fetcher = createFetcher(ctx);
  const extractor = createExtractor(ctx);
  const list = ctx.db
    .select()
    .from(sources)
    .where(opts.sourceIds?.length ? inArray(sources.id, opts.sourceIds) : eq(sources.enabled, true))
    .all()
    .filter((s) => s.kind !== 'email_alert');
  let failed = 0;
  let seen = 0;
  const newIds: number[] = [];
  for (const src of list) {
    const now = new Date().toISOString();
    const adapter = ADAPTERS[src.kind];
    try {
      if (!adapter) throw new Error(`Unknown source type ${src.kind}`);
      const raw = await adapter.list(src.config as unknown as SourceConfig, { fetch: fetcher, extractor, log: ctx.log });
      const { jobs: normalized, invalid } = normalizeJobs(raw);
      const res = upsertJobs(ctx, normalized, { atsType: src.kind, sourceId: src.id, companyId: src.companyId });
      // Postings that disappeared from a complete listing are closed.
      const stillThere = new Set([...res.newIds, ...res.seenIds]);
      if (src.kind !== 'rss' && src.kind !== 'arbeitnow') {
        for (const j of ctx.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.sourceId, src.id), isNull(jobs.closedAt))).all()) {
          if (!stillThere.has(j.id)) ctx.db.update(jobs).set({ closedAt: now }).where(eq(jobs.id, j.id)).run();
        }
      }
      seen += normalized.length;
      newIds.push(...res.newIds);
      ctx.db
        .update(sources)
        .set({ lastRunAt: now, lastSuccessAt: now, lastJobCount: normalized.length, ...(invalid ? { lastError: `${invalid} postings could not be read`, lastErrorAt: now } : {}) })
        .where(eq(sources.id, src.id))
        .run();
    } catch (err) {
      failed++;
      const msg = err instanceof FetchError ? `${err.kind}: ${err.message}` : (err as Error).message;
      ctx.log.warn({ source: src.name, err: msg }, 'source failed');
      ctx.db.update(sources).set({ lastRunAt: now, lastErrorAt: now, lastError: msg.slice(0, 500) }).where(eq(sources.id, src.id)).run();
    }
  }
  // Score new jobs plus any earlier jobs that never got a match (e.g. budget pause, no profile yet).
  const unmatched = ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .leftJoin(matches, eq(matches.jobId, jobs.id))
    .where(and(isNull(matches.id), isNull(jobs.closedAt)))
    .all()
    .map((r) => r.id);
  const { shown } = await matchJobs(ctx, [...new Set([...newIds, ...unmatched])]);
  const { created } = promoteMatches(ctx, shown);
  const status = failed === 0 ? 'succeeded' : failed === list.length && list.length > 0 ? 'failed' : 'partial';
  ctx.db
    .update(scanRuns)
    .set({ status, sourcesTotal: list.length, sourcesFailed: failed, jobsSeen: seen, jobsNew: newIds.length, matchesNew: created.length, finishedAt: new Date().toISOString() })
    .where(eq(scanRuns.id, run.id))
    .run();
  if (created.length > 0 || failed > 0) {
    notify(ctx, {
      kind: 'scan_summary',
      title: created.length ? `${created.length} new matching ${created.length === 1 ? 'job' : 'jobs'}` : 'Scan finished with errors',
      body: `${seen} postings checked from ${list.length} sources${failed ? `, ${failed} failed (see Diagnostics)` : ''}.`,
      link: created.length ? '/' : '/diagnostics',
    });
  }
  ctx.bus.invalidate('board', 'summary', 'diagnostics', 'scan');
  return { runId: run.id, sourcesTotal: list.length, sourcesFailed: failed, jobsSeen: seen, jobsNew: newIds.length, matchesNew: created.length };
}
