import type { AtsType } from '@jobhunter/shared';
import { parseWorkdayUrl } from './adapters/workday.js';

export interface DetectedSource {
  kind: AtsType;
  slug?: string;
  url?: string;
  options?: Record<string, unknown>;
}

const URL_RULES: { re: RegExp; kind: AtsType; options?: Record<string, unknown> }[] = [
  { re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/iu, kind: 'greenhouse' },
  { re: /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/iu, kind: 'greenhouse' },
  { re: /jobs\.eu\.lever\.co\/([\w.-]+)/iu, kind: 'lever', options: { region: 'eu' } },
  { re: /jobs\.lever\.co\/([\w.-]+)/iu, kind: 'lever' },
  { re: /jobs\.ashbyhq\.com\/([\w.%-]+)/iu, kind: 'ashby' },
  { re: /(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/iu, kind: 'smartrecruiters' },
  { re: /apply\.workable\.com\/([\w-]+)/iu, kind: 'workable' },
  { re: /([\w-]+)\.workable\.com/iu, kind: 'workable' },
  { re: /([\w-]+)\.recruitee\.com/iu, kind: 'recruitee' },
  { re: /([\w-]+)\.jobs\.personio\.de/iu, kind: 'personio' },
  { re: /([\w-]+)\.jobs\.personio\.com/iu, kind: 'personio', options: { domain: 'com' } },
];

const IGNORED_SLUGS = new Set(['embed', 'www', 'jobs', 'apply', 'api', 'careers']);

/** Detect the ATS from a careers URL (spec §5.2). */
export function detectFromUrl(url: string): DetectedSource | null {
  const wd = parseWorkdayUrl(url);
  if (wd) return { kind: 'workday', url, slug: wd.tenant };
  if (/\.(rss|xml)(\?|$)|\/feed\/?(\?|$)|\/rss\/?(\?|$)/iu.test(url)) return { kind: 'rss', url };
  for (const r of URL_RULES) {
    const m = r.re.exec(url);
    if (m?.[1] && !IGNORED_SLUGS.has(m[1].toLowerCase())) return { kind: r.kind, slug: decodeURIComponent(m[1]), ...(r.options ? { options: r.options } : {}) };
  }
  return null;
}

/** Look for embedded ATS widgets/links inside a company's own careers page. */
export function detectFromHtml(html: string, pageUrl: string): DetectedSource | null {
  const candidates = [
    ...html.matchAll(/https?:\/\/[^"'\s<>]*(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com|personio\.(?:de|com)|myworkdayjobs\.com)[^"'\s<>]*/giu),
  ].map((m) => m[0]);
  const ghEmbed = /greenhouse\.io\/embed\/job_board\/js\?for=([\w-]+)/iu.exec(html);
  if (ghEmbed?.[1]) return { kind: 'greenhouse', slug: ghEmbed[1] };
  for (const c of candidates) {
    const d = detectFromUrl(c.replace(/&amp;/gu, '&'));
    if (d) return d;
  }
  const own = detectFromUrl(pageUrl);
  return own;
}

/** Slug guesses for probing public ATS APIs when only a company name is known. */
export function slugCandidates(name: string): string[] {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(inc|ltd|llc|gmbh|ag|sa|plc|corp|co)\b\.?/gu, '')
    .trim();
  const joined = base.replace(/[^a-z0-9]+/gu, '');
  const dashed = base.replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return [...new Set([joined, dashed].filter((s) => s.length >= 2))];
}
