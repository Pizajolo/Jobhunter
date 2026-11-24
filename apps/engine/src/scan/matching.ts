import { normalizeLocation, stripDiacritics, type SearchProfile } from '@jobhunter/shared';

export interface PrefilterJob {
  title: string;
  company: string;
  location: string;
  remote: string;
  language: string | null;
  description: string;
  salary: { min: number | null; max: number | null; currency: string | null; period: string | null } | null;
}

const lower = (s: string) => stripDiacritics(s).toLowerCase();

const GENERIC_ROLE_WORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'head', 'of', 'the', 'and', 'for', 'principal', 'staff', 'manager', 'director',
  'vp', 'vice', 'president', 'chief', 'associate', 'assistant', 'i', 'ii', 'iii', 'm', 'w', 'd', 'f',
]);

/** Deterministic, free checks before any model call (spec §5.3 match step). */
export function prefilter(job: PrefilterJob, s: SearchProfile): { pass: boolean; reason: string | null } {
  const title = lower(job.title);
  const text = `${title} ${lower(job.description.slice(0, 3000))}`;
  for (const ex of s.exclusions) {
    const e = lower(ex).trim();
    if (e && title.includes(e)) return { pass: false, reason: `Excluded keyword "${ex}" in title` };
  }
  for (const c of s.excludedCompanies) {
    if (c.trim() && lower(job.company).includes(lower(c).trim())) return { pass: false, reason: `Excluded company ${c}` };
  }
  if (s.remotePolicy === 'remote_only' && (job.remote === 'onsite' || job.remote === 'hybrid')) {
    return { pass: false, reason: `Not remote (${job.remote})` };
  }
  if (s.locations.length && job.remote !== 'remote') {
    const loc = normalizeLocation(job.location);
    const wanted = s.locations.map((l) => normalizeLocation(l)).filter(Boolean);
    const anyRemoteWanted = s.locations.some((l) => /remote|anywhere/iu.test(l));
    const hit = !loc || wanted.some((w) => loc.includes(w) || w.includes(loc));
    if (!hit && !(anyRemoteWanted && job.remote === 'unknown')) return { pass: false, reason: `Location "${job.location}" not in your locations` };
  }
  if (s.minSalary && job.salary && job.salary.currency === s.minSalary.currency && (job.salary.period ?? 'year') === 'year') {
    const top = job.salary.max ?? job.salary.min;
    if (top !== null && top < s.minSalary.amount) return { pass: false, reason: `Salary below ${s.minSalary.amount} ${s.minSalary.currency}` };
  }
  if (s.languages.length && job.language && !s.languages.some((l) => lower(l).startsWith(lower(job.language!)))) {
    return { pass: false, reason: `Posting language ${job.language}` };
  }
  if (s.roles.length) {
    // Generic words ("manager", "senior") don't identify a role family: "Office Manager" ≠ "Product Manager".
    const roleHit = s.roles.some((r) => {
      const words = lower(r).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
      const distinctive = words.filter((w) => !GENERIC_ROLE_WORDS.has(w));
      return distinctive.length ? distinctive.some((w) => title.includes(w)) : title.includes(lower(r));
    });
    const hasRole = roleHit;
    const hasMust = s.mustHave.some((m) => text.includes(lower(m)));
    if (!hasRole && !hasMust) return { pass: false, reason: 'Title does not match your target roles' };
  }
  return { pass: true, reason: null };
}

export function salaryText(s: PrefilterJob['salary']): string | null {
  if (!s || (s.min === null && s.max === null)) return null;
  const range = [s.min, s.max].filter((x): x is number => x !== null).map((n) => n.toLocaleString('en')).join('–');
  return `${s.currency ?? ''} ${range}${s.period ? ` per ${s.period}` : ''}`.trim();
}
