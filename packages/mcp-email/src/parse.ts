import { simpleParser, type AddressObject } from 'mailparser';
import * as cheerio from 'cheerio';
import type { RawEmail } from './types.js';

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value[0];
  return { address: (v?.address ?? '').toLowerCase(), name: v?.name ?? '' };
}

export function htmlToPlain(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, head').remove();
  $('br').replaceWith('\n');
  $('p, div, tr, li, h1, h2, h3, table').each((_i, el) => {
    $(el).append('\n');
  });
  return $.root()
    .text()
    .replace(/ /gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Parse an RFC 822 message (from IMAP, Gmail raw, or .eml fixtures). */
export async function parseRawMessage(source: Buffer | string, meta: { id: string; threadId?: string | null; labels?: string[]; date?: Date }): Promise<RawEmail> {
  const m = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = firstAddress(m.from);
  const to = firstAddress(m.to);
  const html = typeof m.html === 'string' ? m.html : null;
  const text = (m.text && m.text.trim()) || (html ? htmlToPlain(html) : '');
  return {
    providerMessageId: meta.id,
    threadId: meta.threadId ?? null,
    fromAddress: from.address,
    fromName: from.name,
    to: to.address,
    subject: m.subject ?? '',
    receivedAt: (m.date ?? meta.date ?? new Date()).toISOString(),
    text,
    html,
    labels: meta.labels ?? [],
  };
}

/** Drop quoted replies and signatures (for style samples and shorter prompts). */
export function stripQuoted(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^(On .+ wrote:|Am .+ schrieb .+:|Le .+ a écrit :|El .+ escribió:|Em .+ escreveu:)$/u.test(line.trim())) break;
    if (/^-{2,}\s*$/u.test(line.trim()) || /^_{5,}/u.test(line)) break;
    if (/^>/u.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}
