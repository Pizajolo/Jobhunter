import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom } from './util.js';

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

/**
 * Arbeitnow public job board API (mostly Germany / EU). The board is large, so only items matching
 * options.keywords (any) are kept before matching.
 */
export const arbeitnow: JobSource = {
  kind: 'arbeitnow',
  async list(config, ctx) {
    const keywords = (Array.isArray(config.options?.keywords) ? (config.options.keywords as string[]) : []).map((k) => k.toLowerCase());
    const maxPages = Number(config.options?.maxPages ?? 3);
    const out = [];
    let url: string | null = 'https://www.arbeitnow.com/api/job-board-api';
    for (let page = 0; url && page < maxPages; page++) {
      const data: { data: ArbeitnowJob[]; links?: { next?: string | null } } = await ctx.fetch.json(url);
      for (const j of data.data) {
        const hay = `${j.title} ${j.tags.join(' ')} ${j.location}`.toLowerCase();
        if (keywords.length && !keywords.some((k) => hay.includes(k))) continue;
        out.push({
          sourceJobId: j.slug,
          title: j.title,
          company: j.company_name,
          location: j.location,
          remote: j.remote ? ('remote' as const) : remoteFrom(j.location),
          description: htmlToText(j.description),
          url: j.url,
          applyUrl: j.url,
          postedAt: isoDate(j.created_at),
          employmentType: j.job_types.join(', ') || null,
        });
      }
      url = data.links?.next ?? null;
    }
    return out;
  },
};
