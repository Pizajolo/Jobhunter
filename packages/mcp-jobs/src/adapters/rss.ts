import { XMLParser } from 'fast-xml-parser';
import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom } from './util.js';

type Node = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in v ? String((v as Node)['#text']) : v === undefined || v === null ? '' : String(v));

/**
 * Any RSS 2.0 or Atom job feed. Many boards publish "Company: Title" items; set
 * options.titleFormat = "company: title" to split them.
 */
export const rss: JobSource = {
  kind: 'rss',
  async list(config, ctx) {
    if (!config.url) throw new Error('Feed source needs a URL');
    const res = await ctx.fetch.text(config.url);
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false }).parse(res.body) as Node;
    const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
    const items: Node[] = channel ? asArray(channel.item as Node | Node[]) : asArray((doc.feed as Node | undefined)?.entry as Node | Node[]);
    const splitTitle = config.options?.titleFormat === 'company: title';
    return items.flatMap((it) => {
      const rawTitle = htmlToText(str(it.title));
      const linkNode = it.link as Node | Node[] | string | undefined;
      const link = typeof linkNode === 'string' ? linkNode : str((asArray(linkNode as Node | Node[])[0] as Node | undefined)?.['@href'] ?? linkNode);
      if (!rawTitle || !link) return [];
      let company = config.company ?? '';
      let title = rawTitle;
      if (splitTitle && rawTitle.includes(':')) {
        company = rawTitle.slice(0, rawTitle.indexOf(':')).trim();
        title = rawTitle.slice(rawTitle.indexOf(':') + 1).trim();
      }
      const description = htmlToText(str(it.description ?? it['content:encoded'] ?? it.content ?? it.summary));
      const region = str(it.region ?? it['job:location'] ?? '');
      return [
        {
          sourceJobId: str(it.guid ?? it.id) || link,
          title,
          company: company || (config.company ?? new URL(config.url!).hostname),
          location: region,
          remote: remoteFrom(region, title, description.slice(0, 300)),
          description,
          url: link,
          applyUrl: link,
          postedAt: isoDate(str(it.pubDate ?? it.published ?? it.updated)),
        },
      ];
    });
  },
};
