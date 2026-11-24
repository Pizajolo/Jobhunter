import { domainMatches, normalizeCompany, normalizeTitle, registrableDomain, similarity } from '@jobhunter/shared';

export interface MatchCandidate {
  applicationId: number;
  company: string;
  title: string;
  status: string;
  senderDomains: string[];
  atsRefIds: string[];
  companyDomain: string | null;
  appliedAt: string | null;
}

export interface MatchInfo {
  fromAddress: string;
  subject: string;
  text: string;
  company: string | null;
  role: string | null;
  referenceIds: string[];
}

export interface EmailMatch {
  applicationId: number;
  confidence: number;
  reason: string;
}

/**
 * Link an email to an application (spec §5.5 step 3): stored sender domains and ATS reference IDs
 * first, then company name and role similarity. Returns null when nothing is convincing.
 */
export function matchEmail(info: MatchInfo, candidates: MatchCandidate[]): EmailMatch | null {
  const dom = info.fromAddress.slice(info.fromAddress.lastIndexOf('@') + 1).toLowerCase();
  const hay = `${info.subject}\n${info.text}`.toLowerCase();
  const scored: EmailMatch[] = [];
  for (const c of candidates) {
    let score = 0;
    const reasons: string[] = [];
    if (c.atsRefIds.some((r) => r && (info.referenceIds.includes(r) || hay.includes(r.toLowerCase())))) {
      score += 0.6;
      reasons.push('reference id');
    }
    const companyNorm = normalizeCompany(c.company);
    const companyHit =
      (info.company && similarity(normalizeCompany(info.company), companyNorm) > 0.7) || (companyNorm.length > 2 && hay.includes(companyNorm));
    const domainHit =
      c.senderDomains.some((d) => domainMatches(dom, d)) ||
      (!!c.companyDomain && (domainMatches(dom, c.companyDomain) || registrableDomain(dom) === registrableDomain(c.companyDomain)));
    if (domainHit && companyHit) {
      score += 0.45;
      reasons.push('sender domain');
    } else if (domainHit && !isSharedAtsDomain(dom)) {
      // The employer's own mail domain is strong evidence on its own.
      score += 0.5;
      reasons.push('company domain');
    }
    if (companyHit) {
      score += 0.35;
      reasons.push('company name');
    }
    if (info.role) {
      const sim = similarity(normalizeTitle(info.role), normalizeTitle(c.title));
      if (sim > 0.55) {
        score += 0.2 * sim;
        reasons.push('role');
      }
    } else if (normalizeTitle(c.title).length > 4 && hay.includes(normalizeTitle(c.title))) {
      score += 0.15;
      reasons.push('role in text');
    }
    if (score > 0) scored.push({ applicationId: c.applicationId, confidence: Math.min(1, score), reason: reasons.join(', ') });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (!best || best.confidence < 0.35) return null;
  const second = scored[1];
  // Two applications at the same company and no role signal: ambiguous.
  if (second && best.confidence - second.confidence < 0.1) return { ...best, confidence: Math.min(best.confidence, 0.5) };
  return best;
}

/** ATS domains are shared by many employers, so a sender domain alone proves nothing there. */
function isSharedAtsDomain(dom: string): boolean {
  return /greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|recruitee|personio|myworkday|workday|successfactors|taleo|icims|jobvite|teamtailor|softgarden/iu.test(dom);
}
