/** Text normalisation and similarity helpers used by dedup, matching and email linking. */

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|sarl|s\.?a\.?|s\.?l\.?|bv|nv|plc|co|corp|corporation|company|group|holding|holdings|se|kg|oy|ab|as|spa|srl|lda|s\.?a\.? de c\.?v\.?)\b\.?/giu;

export function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '');
}

export function normalizeCompany(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

const TITLE_NOISE = /\b(m\/w\/d|w\/m\/d|m\/f\/d|f\/m\/d|h\/f|f\/h|m\/f|all genders?)\b|\d{1,3}\s?[-–]\s?\d{1,3}\s?%|\d{1,3}\s?%/giu;
const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/gu, 'senior'],
  [/\bjr\.?\b/gu, 'junior'],
  [/\bmgr\.?\b/gu, 'manager'],
  [/\beng\.?\b/gu, 'engineer'],
  [/\bdev\b/gu, 'developer'],
  [/\bpm\b/gu, 'product manager'],
  [/\bvp\b/gu, 'vice president'],
];

export function normalizeTitle(title: string): string {
  let t = stripDiacritics(title).toLowerCase().replace(TITLE_NOISE, ' ').replace(/\([^)]*\)/gu, ' ');
  for (const [re, rep] of TITLE_SYNONYMS) t = t.replace(re, rep);
  return t
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function normalizeLocation(loc: string): string {
  return stripDiacritics(loc)
    .toLowerCase()
    .replace(/\b(switzerland|schweiz|suisse|svizzera|germany|deutschland|portugal|spain|espana|france|mexico|united kingdom|uk|usa|united states)\b/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function tokens(s: string): Set<string> {
  return new Set(s.split(/\s+/u).filter((w) => w.length > 0));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Trigram similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  return jaccard(trigrams(a), trigrams(b));
}

export function domainOf(urlOrEmail: string): string | null {
  const at = urlOrEmail.lastIndexOf('@');
  if (at >= 0 && !urlOrEmail.includes('://')) {
    return urlOrEmail
      .slice(at + 1)
      .replace(/[>\s].*$/u, '')
      .toLowerCase();
  }
  try {
    return new URL(urlOrEmail).hostname.toLowerCase().replace(/^www\./u, '');
  } catch {
    return null;
  }
}

/** "jobs.boards.greenhouse.io" -> "greenhouse.io" (good enough for matching, not a PSL). */
export function registrableDomain(host: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(host) || host === 'localhost') return host;
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const twoLevel = new Set(['co.uk', 'com.mx', 'com.br', 'co.jp', 'com.au', 'com.pt', 'org.uk', 'ac.uk']);
  const last2 = parts.slice(-2).join('.');
  if (twoLevel.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

export function domainMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().replace(/^\*\./u, '');
  return h === p || h.endsWith(`.${p}`);
}

/** Canonical URL for dedup: drop tracking params, fragment, trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|ref|lever-source|trk|src)/iu.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}
