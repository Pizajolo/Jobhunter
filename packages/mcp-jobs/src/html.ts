import * as cheerio from 'cheerio';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/giu, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → readable plain text (keeps list items and paragraphs on their own lines). */
export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  $('br').replaceWith('\n');
  $('li').each((_i, el) => {
    $(el).prepend('\u2022 ').append('\n');
  });
  $('p, div, h1, h2, h3, h4, h5, h6, tr, section, article').each((_i, el) => {
    $(el).append('\n');
  });
  return $.root()
    .text()
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Main text and links of a careers page, trimmed for a model prompt. */
export function pageForExtraction(html: string, baseUrl: string, maxChars = 30_000): { text: string; links: { text: string; href: string }[] } {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, header nav, footer').remove();
  const links: { text: string; href: string }[] = [];
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/gu, ' ').trim();
    if (!href || !text || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
    try {
      links.push({ text: text.slice(0, 160), href: new URL(href, baseUrl).toString() });
    } catch {
      /* invalid URL */
    }
  });
  const text = htmlToText($.html()).slice(0, maxChars);
  return { text, links: links.slice(0, 400) };
}
