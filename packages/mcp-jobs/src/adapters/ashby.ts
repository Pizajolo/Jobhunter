import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, parseSalary, remoteFrom, requireSlug } from './util.js';

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  department?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isListed?: boolean;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string; minValue?: number; maxValue?: number }[];
  };
}

/** Ashby Job Posting API: api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true */
export const ashby: JobSource = {
  kind: 'ashby',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Ashby');
    const data = await ctx.fetch.json<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    return data.jobs
      .filter((j) => j.isListed !== false)
      .map((j) => {
        const base = j.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
        const location = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join(' / ');
        return {
          sourceJobId: j.id,
          title: j.title,
          company: config.company ?? config.slug!,
          location,
          remote: remoteFrom(j.workplaceType, j.isRemote ?? null, location),
          salary: base
            ? {
                min: base.minValue ?? null,
                max: base.maxValue ?? null,
                currency: base.currencyCode ?? null,
                period: /hour/iu.test(base.interval ?? '') ? 'hour' : /month/iu.test(base.interval ?? '') ? 'month' : 'year',
              }
            : parseSalary(j.compensation?.compensationTierSummary),
          description: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ''),
          url: j.jobUrl,
          applyUrl: j.applyUrl ?? null,
          postedAt: isoDate(j.publishedAt),
          department: j.department ?? null,
          employmentType: j.employmentType ?? null,
        };
      });
  },
};
