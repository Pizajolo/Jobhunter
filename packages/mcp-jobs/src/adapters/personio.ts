import { XMLParser } from 'fast-xml-parser';
import type { JobSource } from '../types.js';
import { decodeEntities, htmlToText } from '../html.js';
import { isoDate, remoteFrom, requireSlug } from './util.js';

interface PersonioPosition {
  id: number | string;
  subcompany?: string;
  office?: string;
  additionalOffices?: { office?: string | string[] };
  department?: string;
  name: string;
  jobDescriptions?: { jobDescription?: { name?: string; value?: string } | { name?: string; value?: string }[] } | string;
  employmentType?: string;
  schedule?: string;
  createdAt?: string;
}

/** Personio public XML feed: {slug}.jobs.personio.de/xml (or .com for some accounts). */
export const personio: JobSource = {
  kind: 'personio',
  async list(config, ctx) {
    const slug = requireSlug(config.slug, 'Personio');
    const domain = config.options?.domain === 'com' ? 'jobs.personio.com' : 'jobs.personio.de';
    const res = await ctx.fetch.text(`https://${slug}.${domain}/xml`);
    const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
    const doc = parser.parse(res.body) as { 'workzag-jobs'?: { position?: PersonioPosition | PersonioPosition[] } };
    const raw = doc['workzag-jobs']?.position;
    const positions = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return positions.map((p) => {
      const jd = typeof p.jobDescriptions === 'object' ? p.jobDescriptions.jobDescription : undefined;
      const parts = jd ? (Array.isArray(jd) ? jd : [jd]) : [];
      const description = parts.map((d) => `${d.name ?? ''}\n${htmlToText(decodeEntities(d.value ?? ''))}`.trim()).join('\n\n');
      const extra = p.additionalOffices?.office;
      const offices = [p.office, ...(Array.isArray(extra) ? extra : extra ? [extra] : [])].filter(Boolean);
      const location = offices.join(' / ');
      const url = `https://${slug}.${domain}/job/${p.id}`;
      return {
        sourceJobId: String(p.id),
        title: p.name,
        company: config.company ?? p.subcompany ?? config.slug!,
        location,
        remote: remoteFrom(location, p.schedule),
        description,
        url,
        applyUrl: url,
        postedAt: isoDate(p.createdAt),
        department: p.department ?? null,
        employmentType: [p.employmentType, p.schedule].filter(Boolean).join(', ') || null,
      };
    });
  },
};
