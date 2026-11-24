import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string;
  requirements?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  careers_url: string;
  careers_apply_url?: string;
  published_at?: string;
  employment_type_code?: string;
  department?: string;
  company_name?: string;
  salary?: { min?: string | number | null; max?: string | number | null; currency?: string | null; period?: string | null };
}

/** Recruitee public API: {slug}.recruitee.com/api/offers/ */
export const recruitee: JobSource = {
  kind: 'recruitee',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Recruitee');
    const data = await ctx.fetch.json<{ offers: RecruiteeOffer[] }>(`https://${slug}.recruitee.com/api/offers/`);
    return data.offers.map((o) => {
      const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
      const period = o.salary?.period ?? '';
      return {
        sourceJobId: String(o.id),
        title: o.title,
        company: config.company ?? o.company_name ?? config.slug!,
        location: o.location ?? [o.city, o.country].filter(Boolean).join(', '),
        remote: o.remote ? 'remote' as const : o.hybrid ? 'hybrid' as const : o.on_site ? 'onsite' as const : remoteFrom(o.location),
        salary:
          o.salary && (o.salary.min || o.salary.max)
            ? { min: num(o.salary.min), max: num(o.salary.max), currency: o.salary.currency ?? null, period: /month/u.test(period) ? 'month' as const : /hour/u.test(period) ? 'hour' as const : 'year' as const }
            : null,
        description: [htmlToText(o.description ?? ''), htmlToText(o.requirements ?? '')].filter(Boolean).join('\n\n'),
        url: o.careers_url,
        applyUrl: o.careers_apply_url ?? o.careers_url,
        postedAt: isoDate(o.published_at),
        department: o.department ?? null,
        employmentType: o.employment_type_code ?? null,
      };
    });
  },
};
