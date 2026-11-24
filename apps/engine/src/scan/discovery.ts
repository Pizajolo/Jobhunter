import { companies, getProfile, getSearchProfile, getSettings } from '@jobhunter/db';
import { normalizeCompany, registrableDomain } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { notify } from '../notify.js';
import { runTask } from '../agent/runner.js';
import { profileSummary } from '../profile/facts.js';
import { registerJob } from '../scheduler.js';
import { companyDiscoveryTask, type DiscoveryOutputT } from '../tasks/discovery.js';
import { WEB_BLOCKED_DOMAINS } from '../agent/backends/agent-sdk.js';
import type { Fetcher } from '@jobhunter/mcp-jobs';
import { addCompany } from './companies.js';
import { createFetcher } from './pipeline.js';

export interface DiscoveryResult {
  ok: boolean;
  added: number;
  suggested: number;
  skipped: number;
  message?: string;
}

let running: Promise<DiscoveryResult> | null = null;

export function isDiscoveryRunning(): boolean {
  return running !== null;
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Shared ATS hosts, not one employer, so they don't identify a company by domain. */
const SHARED_HOSTS = new Set(['greenhouse.io', 'lever.co', 'ashbyhq.com', 'smartrecruiters.com', 'workable.com', 'recruitee.com', 'personio.de', 'personio.com', 'myworkdayjobs.com', 'workday.com']);

/**
 * Weekly company discovery (spec §5.2). Suggestions go to Settings → Companies for accept/reject,
 * or straight onto the watch list when "auto-add" is on.
 */
export function runDiscovery(ctx: AppContext, trigger: 'schedule' | 'catchup' | 'manual'): Promise<DiscoveryResult> {
  if (running) return running;
  running = discover(ctx, trigger).finally(() => {
    running = null;
    ctx.bus.invalidate('companies', 'diagnostics');
  });
  return running;
}

async function discover(ctx: AppContext, trigger: string): Promise<DiscoveryResult> {
  const settings = getSettings(ctx.db);
  if (!settings.discovery.enabled) return { ok: false, added: 0, suggested: 0, skipped: 0, message: 'Discovery is turned off' };
  const search = getSearchProfile(ctx.db).data;
  if (search.roles.length === 0 && search.industries.length === 0) {
    return { ok: false, added: 0, suggested: 0, skipped: 0, message: 'Add target roles or industries to your search profile first' };
  }
  const all = ctx.db.select().from(companies).all();
  const known = [...new Set([...all.map((c) => c.name), ...search.excludedCompanies])];
  ctx.log.info({ trigger, known: known.length }, 'company discovery started');
  const r = await runTask(ctx, companyDiscoveryTask, { candidate: profileSummary(getProfile(ctx.db).data), search, known, max: 8 }, { webTools: true, maxTurns: 40 });
  if (!r.ok) return { ok: false, added: 0, suggested: 0, skipped: 0, message: r.error.message };
  const out = await storeSuggestions(ctx, r.output, settings.discovery.autoAdd);
  if (out.added + out.suggested > 0) {
    notify(ctx, {
      kind: 'scan_summary',
      title: settings.discovery.autoAdd ? `${out.added} new companies added to your watch list` : `${out.suggested} companies suggested`,
      body: settings.discovery.autoAdd ? 'Found by the weekly discovery. Their jobs appear after the next scan.' : 'Review them in Settings → Companies.',
      link: '/settings#companies',
    });
  }
  return { ok: true, ...out };
}

/** Deduplicates against every known company (by name and by website domain) and stores the rest. */
export async function storeSuggestions(
  ctx: AppContext,
  output: DiscoveryOutputT,
  autoAdd: boolean,
  fetcher: Fetcher = createFetcher(ctx),
): Promise<Omit<DiscoveryResult, 'ok' | 'message'>> {
  const existing = ctx.db.select().from(companies).all();
  const excluded = getSearchProfile(ctx.db).data.excludedCompanies.map(normalizeCompany);
  const names = new Set([...existing.map((c) => c.normName), ...excluded]);
  const domains = new Set(existing.map((c) => domainOf(c.careersUrl)).filter((d): d is string => !!d && !SHARED_HOSTS.has(d)));
  let added = 0;
  let suggested = 0;
  let skipped = 0;
  for (const c of output.companies) {
    const norm = normalizeCompany(c.name);
    const httpUrl = (u: string | null) => (u && /^https?:\/\//u.test(u) && domainOf(u) ? u : null);
    const careers = httpUrl(c.careersUrl) ?? httpUrl(c.website);
    const domain = domainOf(careers);
    const blocked = [domainOf(c.careersUrl), domainOf(c.website)].some((d) => d && WEB_BLOCKED_DOMAINS.includes(d));
    if (!norm || names.has(norm) || (domain && !SHARED_HOSTS.has(domain) && domains.has(domain)) || blocked) {
      skipped++;
      continue;
    }
    const reason = c.location ? `${c.reason} (${c.location})` : c.reason;
    await addCompany(ctx, {
      name: c.name,
      ...(careers ? { careersUrl: careers } : {}),
      source: 'discovered',
      reason,
      watchStatus: autoAdd ? 'watching' : 'suggested',
    }, fetcher);
    names.add(norm);
    if (domain) domains.add(domain);
    if (autoAdd) added++;
    else suggested++;
  }
  return { added, suggested, skipped };
}

registerJob({
  name: 'discovery',
  schedule: (ctx) => {
    const s = getSettings(ctx.db);
    // Mondays, after the daily scan time has passed.
    return s.discovery.enabled && s.discovery.frequency === 'weekly' ? { kind: 'weekly', weekday: 1, time: '09:15' } : { kind: 'off' };
  },
  run: (ctx, trigger) => runDiscovery(ctx, trigger),
});
