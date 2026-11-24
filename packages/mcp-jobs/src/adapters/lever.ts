import type { JobSource } from '../types.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  country?: string;
  categories?: { location?: string; team?: string; commitment?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

/** Lever Postings API: api.lever.co/v0/postings/{slug}?mode=json (EU accounts: api.eu.lever.co) */
export const lever: JobSource = {
  kind: 'lever',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Lever');
    const host = config.options?.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const data = await ctx.fetch.json<LeverPosting[]>(`https://${host}/v0/postings/${slug}?mode=json`);
    return data.map((p) => {
      const lists = (p.lists ?? []).map((l) => `${l.text}\n${l.content.replace(/<[^>]+>/gu, '\n').replace(/\n+/gu, '\n')}`).join('\n\n');
      const description = [p.descriptionPlain, lists, p.additionalPlain].filter(Boolean).join('\n\n').trim();
      const location = p.categories?.allLocations?.join(' / ') ?? p.categories?.location ?? '';
      const interval = p.salaryRange?.interval ?? '';
      return {
        sourceJobId: p.id,
        title: p.text,
        company: config.company ?? config.slug!,
        location,
        remote: remoteFrom(p.workplaceType, location),
        salary: p.salaryRange
          ? {
              min: p.salaryRange.min ?? null,
              max: p.salaryRange.max ?? null,
              currency: p.salaryRange.currency ?? null,
              period: /hour/u.test(interval) ? 'hour' : /month/u.test(interval) ? 'month' : 'year',
            }
          : null,
        description,
        url: p.hostedUrl,
        applyUrl: p.applyUrl ?? `${p.hostedUrl}/apply`,
        postedAt: isoDate(p.createdAt),
        department: p.categories?.team ?? null,
        employmentType: p.categories?.commitment ?? null,
      };
    });
  },
};
