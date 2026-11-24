import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
  ref?: string;
}
interface SrDetail {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
}

const MAX_DETAILS = 40;

/** SmartRecruiters Posting API: api.smartrecruiters.com/v1/companies/{slug}/postings (+ one call per posting for details). */
export const smartrecruiters: JobSource = {
  kind: 'smartrecruiters',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'SmartRecruiters');
    const out = [];
    let offset = 0;
    const all: SrPosting[] = [];
    while (offset < 500) {
      const page = await ctx.fetch.json<{ content: SrPosting[]; totalFound: number }>(
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}`,
      );
      all.push(...page.content);
      offset += 100;
      if (offset >= page.totalFound || page.content.length === 0) break;
    }
    for (const [i, p] of all.entries()) {
      let detail: SrDetail | null = null;
      if (i < MAX_DETAILS) {
        try {
          detail = await ctx.fetch.json<SrDetail>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${encodeURIComponent(p.id)}`);
        } catch {
          detail = null;
        }
      }
      const sections = detail?.jobAd?.sections ?? {};
      const description = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
        .map((k) => sections[k])
        .filter((s): s is { title?: string; text?: string } => !!s?.text)
        .map((s) => `${s.title ?? ''}\n${htmlToText(s.text ?? '')}`.trim())
        .join('\n\n');
      const loc = p.location ?? {};
      const location = loc.fullLocation ?? [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', ');
      const url = detail?.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${p.id}`;
      out.push({
        sourceJobId: p.id,
        title: p.name,
        company: config.company ?? p.company?.name ?? config.slug!,
        location,
        remote: loc.remote ? 'remote' as const : loc.hybrid ? 'hybrid' as const : remoteFrom(location),
        description,
        url,
        applyUrl: detail?.applyUrl ?? url,
        postedAt: isoDate(p.releasedDate),
        department: p.department?.label ?? null,
        employmentType: p.typeOfEmployment?.label ?? null,
      });
    }
    return out;
  },
};
