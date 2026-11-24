import * as cheerio from 'cheerio';
import type { RawEmail } from './types.js';

export interface AlertJob {
  title: string;
  company: string;
  location: string;
  url: string;
  sourceJobId: string;
}

/**
 * Deterministic parser for LinkedIn job-alert emails: job cards link to
 * linkedin.com/(comm/)jobs/view/<id>. Returns [] when the layout isn't recognised (the
 * model-based `alert_parse` task is the fallback). Jobhunter never visits LinkedIn itself.
 */
export function parseLinkedInAlert(email: RawEmail): AlertJob[] {
  if (!email.html || !/linkedin\.com/iu.test(email.fromAddress)) return [];
  const $ = cheerio.load(email.html);
  const jobs = new Map<string, AlertJob>();
  $('a[href*="/jobs/view/"]').each((_i, a) => {
    const href = $(a).attr('href') ?? '';
    const id = /\/jobs\/view\/(\d+)/u.exec(href)?.[1];
    const title = $(a).text().replace(/\s+/gu, ' ').trim();
    if (!id || !title || jobs.has(id) || /see all|view job|alle anzeigen|voir/iu.test(title)) return;
    // Company and location sit in the text right after the title link inside the same card.
    const card = $(a).closest('td, table, div').clone();
    card.find('a[href*="/jobs/view/"]').remove();
    card.find('br').replaceWith('\n');
    card.find('div, p, tr, td, span, table').each((_j, el) => {
      $(el).append('\n');
    });
    const lines = card
      .text()
      .split('\n')
      .map((l) => l.replace(/\s+/gu, ' ').trim())
      .filter((l) => l && l !== title);
    const companyLine = lines.find((l) => l.includes('·')) ?? lines[0] ?? '';
    const [company, location] = companyLine.includes('·') ? companyLine.split('·').map((s) => s.trim()) : [companyLine, lines[1] ?? ''];
    if (!company) return;
    jobs.set(id, { title, company: company!, location: location ?? '', url: `https://www.linkedin.com/jobs/view/${id}`, sourceJobId: `linkedin:${id}` });
  });
  return [...jobs.values()];
}
