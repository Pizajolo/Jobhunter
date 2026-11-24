import type { JobSource } from '../types.js';
import { htmlToText, pageForExtraction } from '../html.js';
import { remoteFrom } from './util.js';

const MAX_PAGES = 5;
const MAX_DETAIL_FETCHES = 25;

/**
 * Any careers page: fetch it, let a small model list the postings, follow pagination on the same
 * site, and fetch posting pages for descriptions. Extraction results are cached by content hash
 * by the engine's extractor, so unchanged pages cost nothing.
 */
export const generic: JobSource = {
  kind: 'generic',
  async list(config, ctx) {
    if (!config.url) throw new Error('Careers page source needs a URL');
    if (!ctx.extractor) throw new Error('No page extractor available');
    const origin = new URL(config.url).origin;
    const seen = new Set<string>();
    const jobs: { title: string; location: string | null; url: string | null; description: string | null }[] = [];
    let next: string | null = config.url;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      if (seen.has(next) || ctx.signal?.aborted) break;
      seen.add(next);
      const res = await ctx.fetch.text(next);
      const { text, links } = pageForExtraction(res.body, res.url);
      const extracted = await ctx.extractor.extract({ url: res.url, text, links });
      jobs.push(...extracted.jobs);
      next = extracted.nextPageUrl && extracted.nextPageUrl.startsWith(origin) ? extracted.nextPageUrl : null;
    }
    const out = [];
    let details = 0;
    for (const j of jobs) {
      const url = j.url ? new URL(j.url, config.url).toString() : `${config.url}#${encodeURIComponent(j.title)}`;
      let description = j.description ?? '';
      if (j.url && description.length < 200 && details < MAX_DETAIL_FETCHES && url.startsWith(origin)) {
        details++;
        try {
          const page = await ctx.fetch.text(url);
          description = htmlToText(page.body).slice(0, 12_000);
        } catch {
          /* keep what we have */
        }
      }
      out.push({
        sourceJobId: url,
        title: j.title,
        company: config.company ?? new URL(config.url).hostname,
        location: j.location ?? '',
        remote: remoteFrom(j.location, description.slice(0, 600)),
        description,
        url,
        applyUrl: url,
      });
    }
    return out;
  },
};
