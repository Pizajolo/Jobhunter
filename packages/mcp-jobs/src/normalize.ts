import { createHash } from 'node:crypto';
import {
  RawJobSchema,
  canonicalUrl,
  normalizeCompany,
  normalizeLocation,
  normalizeTitle,
  similarity,
  type RawJob,
  type RawJobInput,
} from '@jobhunter/shared';

export interface NormalizedJob extends RawJob {
  normCompany: string;
  normTitle: string;
  normLocation: string;
  canonicalUrl: string;
  contentHash: string;
}

/** Validate and normalise an adapter's output. Invalid items are dropped and reported. */
export function normalizeJobs(items: RawJobInput[]): { jobs: NormalizedJob[]; invalid: number } {
  const jobs: NormalizedJob[] = [];
  let invalid = 0;
  for (const item of items) {
    const parsed = RawJobSchema.safeParse({ ...item, title: item.title?.trim(), company: item.company?.trim() });
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const j = parsed.data;
    const description = j.description.slice(0, 40_000);
    jobs.push({
      ...j,
      description,
      normCompany: normalizeCompany(j.company),
      normTitle: normalizeTitle(j.title),
      normLocation: normalizeLocation(j.location),
      canonicalUrl: canonicalUrl(j.url),
      contentHash: createHash('sha256').update(`${j.title}\n${j.location}\n${description}`).digest('hex').slice(0, 32),
    });
  }
  return { jobs, invalid };
}

export interface ExistingJobKey {
  id: number;
  atsType: string;
  atsJobId: string | null;
  canonicalUrl: string;
  normCompany: string;
  normTitle: string;
  normLocation: string;
}

export const TITLE_SIMILARITY = 0.82;
export const LOCATION_SIMILARITY = 0.6;

/**
 * Dedup rule (spec §5.3): same ATS id or same canonical URL, or same company + similar title +
 * similar location. Returns the id of the existing job, or null when the posting is new.
 */
export function findDuplicate(job: NormalizedJob & { atsType: string }, existing: ExistingJobKey[]): number | null {
  for (const e of existing) {
    if (e.atsType === job.atsType && e.atsJobId && e.atsJobId === job.sourceJobId) return e.id;
    if (e.canonicalUrl === job.canonicalUrl) return e.id;
  }
  for (const e of existing) {
    if (e.normCompany !== job.normCompany && similarity(e.normCompany, job.normCompany) < 0.9) continue;
    if (similarity(e.normTitle, job.normTitle) < TITLE_SIMILARITY) continue;
    const locA = e.normLocation;
    const locB = job.normLocation;
    if (!locA || !locB || similarity(locA, locB) >= LOCATION_SIMILARITY || locA.includes(locB) || locB.includes(locA)) return e.id;
  }
  return null;
}
