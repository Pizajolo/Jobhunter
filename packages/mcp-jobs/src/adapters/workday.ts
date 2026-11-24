import type { JobSource, SourceConfig, SourceContext } from '../types.js';
import { htmlToText } from '../html.js';
import { generic } from './generic.js';
import { isoDate, remoteFrom } from './util.js';

interface WdList {
  total: number;
  jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }[];
}
interface WdDetail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    startDate?: string;
    externalUrl?: string;
    jobReqId?: string;
    remoteType?: string;
  };
  hiringOrganization?: { name?: string };
}

/** "https://acme.wd3.myworkdayjobs.com/en-US/External" → host, tenant, site. */
export function parseWorkdayUrl(url: string): { host: string; tenant: string; site: string } | null {
  try {
    const u = new URL(url);
    if (!/\.myworkdayjobs\.com$/u.test(u.hostname) && !/\.myworkdaysite\.com$/u.test(u.hostname)) return null;
    const tenant = u.hostname.split('.')[0]!;
    const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^[a-z]{2}(-[A-Z]{2})?$/u.test(p));
    const site = parts[0];
    if (!site) return null;
    return { host: u.hostname, tenant, site };
  } catch {
    return null;
  }
}

const MAX_JOBS = 200;
const MAX_DETAILS = 40;

async function viaCxs(config: SourceConfig, ctx: SourceContext) {
  const w = parseWorkdayUrl(config.url ?? '');
  if (!w) throw new Error('Workday source needs the careers site URL, e.g. https://acme.wd3.myworkdayjobs.com/External');
  const base = `https://${w.host}/wday/cxs/${w.tenant}/${w.site}`;
  const postings: WdList['jobPostings'] = [];
  for (let offset = 0; offset < MAX_JOBS; offset += 20) {
    const page = await ctx.fetch.json<WdList>(`${base}/jobs`, {
      method: 'POST',
      body: { appliedFacets: {}, limit: 20, offset, searchText: String(config.options?.searchText ?? '') },
    });
    postings.push(...page.jobPostings);
    if (offset + 20 >= page.total || page.jobPostings.length === 0) break;
  }
  const out = [];
  for (const [i, p] of postings.entries()) {
    let d: WdDetail | null = null;
    if (i < MAX_DETAILS) {
      try {
        d = await ctx.fetch.json<WdDetail>(`${base}${p.externalPath}`);
      } catch {
        d = null;
      }
    }
    const info = d?.jobPostingInfo ?? {};
    const location = [info.location ?? p.locationsText, ...(info.additionalLocations ?? [])].filter(Boolean).join(' / ');
    const url = info.externalUrl ?? `https://${w.host}/${w.site}${p.externalPath}`;
    out.push({
      sourceJobId: info.jobReqId ?? p.bulletFields?.[0] ?? p.externalPath,
      title: info.title ?? p.title,
      company: config.company ?? d?.hiringOrganization?.name ?? w.tenant,
      location,
      remote: remoteFrom(info.remoteType, location),
      description: htmlToText(info.jobDescription ?? ''),
      url,
      applyUrl: `${url.replace(/\/$/u, '')}/apply`,
      postedAt: isoDate(info.startDate),
      employmentType: info.timeType ?? null,
    });
  }
  return out;
}

/** Workday via its public job search JSON ("CXS"); falls back to the generic HTML adapter. */
export const workday: JobSource = {
  kind: 'workday',
  async list(config, ctx) {
    try {
      return await viaCxs(config, ctx);
    } catch (err) {
      ctx.log?.warn({ err: String(err), url: config.url }, 'Workday JSON failed, falling back to HTML');
      if (!ctx.extractor) throw err;
      return generic.list(config, ctx);
    }
  },
};
