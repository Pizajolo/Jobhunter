import type { JobSource } from '../types.js';
import { decodeEntities, htmlToText } from '../html.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  first_published?: string;
  language?: string;
  company_name?: string;
  departments?: { name: string }[];
  requisition_id?: string | null;
}

/** Greenhouse Job Board API: boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true */
export const greenhouse: JobSource = {
  kind: 'greenhouse',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Greenhouse');
    const data = await ctx.fetch.json<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return data.jobs.map((j) => {
      const description = htmlToText(decodeEntities(j.content ?? ''));
      const location = j.location?.name ?? '';
      return {
        sourceJobId: String(j.id),
        title: j.title,
        company: config.company ?? j.company_name ?? config.slug!,
        location,
        remote: remoteFrom(location, description.slice(0, 600)),
        language: j.language ?? null,
        description,
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        postedAt: isoDate(j.first_published ?? j.updated_at),
        department: j.departments?.[0]?.name ?? null,
      };
    });
  },
};
