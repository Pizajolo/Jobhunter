import { detectFromHtml, detectFromUrl, slugCandidates, type DetectedSource, type Fetcher } from '@jobhunter/mcp-jobs';
import { companies, eq, sources } from '@jobhunter/db';
import { normalizeCompany } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { createFetcher } from './pipeline.js';

const PROBES: { kind: 'greenhouse' | 'lever' | 'ashby'; url: (slug: string) => string; ok: (j: unknown) => boolean }[] = [
  { kind: 'greenhouse', url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, ok: (j) => Array.isArray((j as { jobs?: unknown }).jobs) },
  { kind: 'lever', url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`, ok: (j) => Array.isArray(j) },
  { kind: 'ashby', url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, ok: (j) => Array.isArray((j as { jobs?: unknown }).jobs) },
];

/** Work out where a company's jobs live (spec §5.2: "the app detects the ATS automatically"). */
export async function detectCompanySource(fetcher: Fetcher, input: { name?: string; careersUrl?: string }): Promise<DetectedSource | null> {
  if (input.careersUrl) {
    const fromUrl = detectFromUrl(input.careersUrl);
    if (fromUrl) return fromUrl;
    try {
      const page = await fetcher.text(input.careersUrl);
      const embedded = detectFromHtml(page.body, page.url);
      if (embedded) return embedded;
    } catch {
      /* fall back to the generic adapter */
    }
    return { kind: 'generic', url: input.careersUrl };
  }
  if (input.name) {
    for (const slug of slugCandidates(input.name)) {
      for (const p of PROBES) {
        try {
          const j = await fetcher.json(p.url(slug));
          if (p.ok(j)) return { kind: p.kind, slug };
        } catch {
          /* not on this ATS */
        }
      }
    }
  }
  return null;
}

export interface AddCompanyResult {
  companyId: number;
  sourceId: number | null;
  detected: DetectedSource | null;
  existed: boolean;
}

export async function addCompany(
  ctx: AppContext,
  input: { name?: string; careersUrl?: string; source?: 'user' | 'discovered'; reason?: string; watchStatus?: 'watching' | 'suggested' },
  fetcher: Fetcher = createFetcher(ctx),
): Promise<AddCompanyResult> {
  const detected = input.watchStatus === 'suggested' ? null : await detectCompanySource(fetcher, input);
  const name = input.name?.trim() || (detected?.slug ?? (input.careersUrl ? new URL(input.careersUrl).hostname.replace(/^www\./u, '') : 'Unknown'));
  const norm = normalizeCompany(name);
  const existing = ctx.db.select().from(companies).where(eq(companies.normName, norm)).get();
  let companyId: number;
  if (existing) {
    companyId = existing.id;
    ctx.db
      .update(companies)
      .set({
        careersUrl: input.careersUrl ?? existing.careersUrl,
        atsType: detected?.kind ?? existing.atsType,
        atsSlug: detected?.slug ?? existing.atsSlug,
        ...(existing.watchStatus !== 'watching' && input.watchStatus !== 'suggested' ? { watchStatus: 'watching' } : {}),
      })
      .where(eq(companies.id, existing.id))
      .run();
  } else {
    companyId = ctx.db
      .insert(companies)
      .values({
        name,
        normName: norm,
        careersUrl: input.careersUrl ?? null,
        atsType: detected?.kind ?? null,
        atsSlug: detected?.slug ?? null,
        source: input.source ?? 'user',
        watchStatus: input.watchStatus ?? 'watching',
        discoveryReason: input.reason ?? null,
      })
      .returning({ id: companies.id })
      .get().id;
  }
  let sourceId: number | null = null;
  if (detected) {
    const prior = ctx.db.select().from(sources).where(eq(sources.companyId, companyId)).all();
    const same = prior.find((s) => s.kind === detected.kind);
    const config = { kind: detected.kind, company: name, ...(detected.slug ? { slug: detected.slug } : {}), ...(detected.url ? { url: detected.url } : {}), ...(detected.options ? { options: detected.options } : {}) };
    if (same) {
      ctx.db.update(sources).set({ config, enabled: true }).where(eq(sources.id, same.id)).run();
      sourceId = same.id;
    } else {
      sourceId = ctx.db
        .insert(sources)
        .values({ kind: detected.kind, name: `${name} (${detected.kind})`, config, companyId })
        .returning({ id: sources.id })
        .get().id;
    }
  }
  ctx.bus.invalidate('companies', 'sources', 'diagnostics');
  return { companyId, sourceId, detected, existed: !!existing };
}
