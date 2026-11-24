import type { ProfileFact } from '@jobhunter/shared';

/** Numbers, but not digits inside words like "B2B" or "0→1" labels. */
const NUM = /(?<![\p{L}\d])\d(?:[\d.,'’]*\d)?/gu;
const digits = (n: string) => n.replace(/[^\d]/gu, '');

/** Numbers in `claim` that don't appear in any of `sources` (separator-insensitive). */
export function unsupportedNumbers(claim: string, sources: string[]): string[] {
  const have = new Set(sources.flatMap((s) => (s.match(NUM) ?? []).map(digits)));
  return (claim.match(NUM) ?? []).filter((n) => !have.has(digits(n)));
}

export interface CitedText {
  text: string;
  factIds: string[];
  /** Allowed to cite nothing (greetings, closings, headings). */
  optional?: boolean;
}

/**
 * Deterministic truthfulness check (spec §2.4): every claim cites existing confirmed facts, and every
 * number in a claim appears in the facts it cites. Returns problems; empty = OK.
 */
export function checkCitations(items: CitedText[], facts: ProfileFact[]): string[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const problems: string[] = [];
  for (const it of items) {
    const short = it.text.slice(0, 70);
    if (!it.factIds.length) {
      if (!it.optional && /\d/u.test(it.text)) problems.push(`"${short}" contains numbers but cites no facts`);
      if (!it.optional) problems.push(`"${short}" cites no facts`);
      continue;
    }
    const unknown = it.factIds.filter((id) => !byId.has(id));
    if (unknown.length) {
      problems.push(`"${short}" cites unknown fact ids ${unknown.join(', ')}`);
      continue;
    }
    const sources = it.factIds.map((id) => byId.get(id)!.text);
    const bad = unsupportedNumbers(it.text, sources);
    if (bad.length) problems.push(`"${short}" has numbers not in the cited facts: ${bad.join(', ')}`);
  }
  return [...new Set(problems)].slice(0, 15);
}
