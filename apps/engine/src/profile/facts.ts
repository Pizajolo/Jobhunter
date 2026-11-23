import { createHash } from 'node:crypto';
import type { Profile, ProfileFact } from '@jobhunter/shared';

export interface DerivedFact {
  id: string;
  text: string;
  category: string;
  refId: string;
  source: ProfileFact['source'];
}

function fid(category: string, refId: string, text: string): string {
  return `f_${createHash('sha1').update(`${category}|${refId}|${text}`).digest('hex').slice(0, 12)}`;
}

function period(start?: string, end?: string): string {
  if (!start && !end) return '';
  return ` (${start ?? '?'} – ${end || 'present'})`;
}

/**
 * Turn the confirmed master profile into atomic facts. Writers may only cite these IDs, so every
 * claim in a generated document traces back to something the user confirmed (spec §2.4).
 */
export function deriveFacts(p: Profile): DerivedFact[] {
  const out: DerivedFact[] = [];
  const add = (category: string, refId: string, text: string) => {
    const t = text.trim().replace(/\s+/gu, ' ');
    if (t) out.push({ id: fid(category, refId, t), text: t, category, refId, source: 'cv' });
  };
  const b = p.basics;
  if (b.name) add('basics', 'basics', `Name: ${b.name}`);
  if (b.label) add('basics', 'basics', `Professional title: ${b.label}`);
  if (b.summary) add('summary', 'basics', b.summary);
  if (b.location?.city || b.location?.countryCode) add('basics', 'basics', `Based in ${[b.location.city, b.location.region, b.location.countryCode].filter(Boolean).join(', ')}`);
  for (const w of p.work) {
    add('work', w.id, `${w.position} at ${w.name}${w.location ? `, ${w.location}` : ''}${period(w.startDate, w.endDate)}`);
    if (w.summary) add('work', w.id, `At ${w.name} (${w.position}): ${w.summary}`);
    for (const h of w.highlights) add('achievement', w.id, `At ${w.name} (${w.position}): ${h}`);
  }
  for (const e of p.education) {
    const what = [e.studyType, e.area].filter(Boolean).join(' in ') || 'Studies';
    add('education', e.id, `${what}, ${e.institution}${e.location ? `, ${e.location}` : ''}${period(e.startDate, e.endDate)}${e.score ? `, grade ${e.score}` : ''}`);
    for (const h of e.highlights) add('education', e.id, `At ${e.institution}: ${h}`);
  }
  for (const s of p.skills) add('skill', s.id, `Skill: ${s.name}${s.level ? ` (${s.level})` : ''}${s.keywords.length ? `: ${s.keywords.join(', ')}` : ''}`);
  for (const l of p.languages) add('language', l.id, `Language: ${l.language}${l.fluency ? ` (${l.fluency})` : ''}`);
  for (const pr of p.projects) {
    add('project', pr.id, `Project: ${pr.name}${pr.description ? `: ${pr.description}` : ''}${period(pr.startDate, pr.endDate)}`);
    for (const h of pr.highlights) add('project', pr.id, `Project ${pr.name}: ${h}`);
  }
  for (const a of p.achievements) add('achievement', a.id, a.metric ? `${a.text} (${a.metric})` : a.text);
  for (const c of p.certificates) add('certificate', c.id, `Certificate: ${c.name}${c.issuer ? `, ${c.issuer}` : ''}${c.date ? ` (${c.date})` : ''}`);
  if (p.interests.length) add('interest', 'interests', `Interests: ${p.interests.join(', ')}`);
  const pref = p.preferences;
  if (pref.workAuthorization) add('preference', 'preferences', `Work authorization: ${pref.workAuthorization}`);
  if (pref.salaryExpectation) add('preference', 'preferences', `Salary expectation: ${pref.salaryExpectation}`);
  if (pref.noticePeriod) add('preference', 'preferences', `Notice period: ${pref.noticePeriod}`);
  if (pref.willingToRelocate !== undefined) add('preference', 'preferences', `Willing to relocate: ${pref.willingToRelocate ? 'yes' : 'no'}`);
  if (pref.motivation) add('preference', 'preferences', `Motivation: ${pref.motivation}`);
  // de-duplicate identical facts
  return [...new Map(out.map((f) => [f.id, f])).values()];
}

/** Compact profile overview for prompts. */
export function profileSummary(p: Profile): string {
  const lines: string[] = [];
  if (p.basics.name) lines.push(`${p.basics.name}${p.basics.label ? ` — ${p.basics.label}` : ''}`);
  for (const w of p.work) lines.push(`- ${w.position} at ${w.name}${period(w.startDate, w.endDate)}: ${w.highlights.length} highlights`);
  for (const e of p.education) lines.push(`- ${[e.studyType, e.area].filter(Boolean).join(' ')} at ${e.institution}${period(e.startDate, e.endDate)}`);
  if (p.skills.length) lines.push(`Skills: ${p.skills.map((s) => s.name).join(', ')}`);
  if (p.languages.length) lines.push(`Languages: ${p.languages.map((l) => `${l.language}${l.fluency ? ` (${l.fluency})` : ''}`).join(', ')}`);
  return lines.join('\n');
}
