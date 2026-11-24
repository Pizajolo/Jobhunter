import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface WorkableJob {
  title: string;
  shortcode: string;
  url: string;
  application_url?: string;
  city?: string;
  state?: string;
  country?: string;
  telecommuting?: boolean;
  employment_type?: string;
  published_on?: string;
  created_at?: string;
  department?: string;
  description?: string;
  locations?: { city?: string; region?: string; country?: string }[];
}

/** Workable public widget API: apply.workable.com/api/v1/widget/accounts/{slug}?details=true */
export const workable: JobSource = {
  kind: 'workable',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Workable');
    const data = await ctx.fetch.json<{ name?: string; jobs: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
    return data.jobs.map((j) => {
      const location = [j.city, j.state, j.country].filter(Boolean).join(', ');
      const description = htmlToText(j.description ?? '');
      return {
        sourceJobId: j.shortcode,
        title: j.title,
        company: config.company ?? data.name ?? config.slug!,
        location,
        remote: j.telecommuting ? 'remote' as const : remoteFrom(location, description.slice(0, 500)),
        description,
        url: j.url,
        applyUrl: j.application_url ?? j.url,
        postedAt: isoDate(j.published_on ?? j.created_at),
        department: j.department ?? null,
        employmentType: j.employment_type ?? null,
      };
    });
  },
};
