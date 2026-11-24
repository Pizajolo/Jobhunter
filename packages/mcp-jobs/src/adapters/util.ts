import type { Remote } from '@jobhunter/shared';

export function remoteFrom(...hints: (string | boolean | null | undefined)[]): Remote {
  for (const h of hints) {
    if (h === true) return 'remote';
    if (typeof h !== 'string') continue;
    const s = h.toLowerCase();
    if (/hybrid|hybride|híbrido|hibrido/u.test(s)) return 'hybrid';
    if (/remote|remoto|télétravail|teletrabajo|home ?office|fully distributed|anywhere/u.test(s)) return 'remote';
    if (/on-?site|onsite|in office|presencial|vor ort|sur site/u.test(s)) return 'onsite';
  }
  return 'unknown';
}

export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function requireSlug(slug: string | undefined, kind: string): string {
  if (!slug) throw new Error(`${kind} source needs a slug (the company's board name)`);
  return encodeURIComponent(slug);
}

/** "€150K – €250K" / "CHF 120,000 - 140,000 per year" → structured salary (best effort). */
export function parseSalary(text: string | null | undefined): { min: number | null; max: number | null; currency: string | null; period: 'year' | 'month' | 'day' | 'hour' | null } | null {
  if (!text) return null;
  const cur = /(CHF|EUR|USD|GBP|MXN|€|\$|£)/u.exec(text)?.[1] ?? null;
  const currency = cur === '€' ? 'EUR' : cur === '$' ? 'USD' : cur === '£' ? 'GBP' : cur;
  const nums = [...text.matchAll(/(\d[\d.,']*)\s*(k|K)?/gu)]
    .map((m) => {
      const n = Number(m[1]!.replace(/[.,'](?=\d{3}\b)/gu, '').replace(',', '.'));
      return m[2] ? n * 1000 : n;
    })
    .filter((n) => Number.isFinite(n) && n >= 10);
  if (!nums.length) return null;
  const period = /hour|stunde|hora|heure/iu.test(text) ? 'hour' : /month|monat|mes|mois/iu.test(text) ? 'month' : /day|tag|día|jour/iu.test(text) ? 'day' : 'year';
  return { min: Math.min(...nums), max: nums.length > 1 ? Math.max(...nums) : null, currency, period };
}
