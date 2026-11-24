import { jaccard, stripDiacritics, tokens, type FormAnswer } from '@jobhunter/shared';
import type { FormField } from './form.js';

/** Everything the filler may use: the approved package and confirmed profile data only (spec §5.6). */
export interface ApplyData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  city: string | null;
  linkedin: string | null;
  website: string | null;
  currentCompany: string | null;
  cvPath: string | null;
  letterPath: string | null;
  letterText: string | null;
  answers: FormAnswer[];
}

export type FieldValue = { kind: 'text'; value: string; source: string } | { kind: 'file'; path: string; source: string } | { kind: 'option'; value: string; source: string };

const norm = (s: string) => stripDiacritics(s).toLowerCase();

const RULES: { re: RegExp; get: (d: ApplyData) => string | null; source: string; kinds?: FormField['kind'][] }[] = [
  { re: /^(first name|given name|vorname|prenom|nombre(?! completo)|primeiro nome|nome proprio)/u, get: (d) => d.firstName, source: 'profile.name' },
  { re: /^(last name|surname|family name|nachname|nom de famille|^nom$|apellidos?|sobrenome|cognome)/u, get: (d) => d.lastName, source: 'profile.name' },
  { re: /^(full name|name|your name|vollstandiger name|nom complet|nombre completo|nome completo|nome e cognome)$/u, get: (d) => `${d.firstName} ${d.lastName}`.trim(), source: 'profile.name' },
  { re: /e-?mail|correo/u, get: (d) => d.email, source: 'profile.email', kinds: ['email', 'text'] },
  { re: /phone|telefon|telephone|telefono|movil|mobile|handy/u, get: (d) => d.phone, source: 'profile.phone' },
  { re: /linkedin/u, get: (d) => d.linkedin, source: 'profile.linkedin' },
  { re: /website|portfolio|personal site|homepage|github/u, get: (d) => d.website, source: 'profile.url' },
  { re: /^(location|city|current location|wohnort|ort|ville|ciudad|cidade|citta)/u, get: (d) => d.city, source: 'profile.location' },
  { re: /current (company|employer)|aktueller arbeitgeber|empresa actual|entreprise actuelle/u, get: (d) => d.currentCompany, source: 'profile.work' },
];

function similarity(a: string, b: string): number {
  return jaccard(tokens(norm(a).replace(/[^\p{L}\p{N}\s]/gu, ' ')), tokens(norm(b).replace(/[^\p{L}\p{N}\s]/gu, ' ')));
}

/** The approved answer whose question best matches a form label. */
export function answerFor(label: string, answers: FormAnswer[]): FormAnswer | null {
  const l = norm(label);
  const topic = (s: string) =>
    /salar|gehalt|salaire|salario|compensation|pay/u.test(s) ? 'salary' : /notice|kundigung|preavis|preaviso|pre-aviso|start date|earliest|verfugbar|disponib/u.test(s) ? 'notice' : /authori|permit|bewilligung|erlaubnis|visa|sponsor|permis|autoriza/u.test(s) ? 'auth' : /why .*(work|join|apply)|motivation|warum|pourquoi|por que|porque/u.test(s) ? 'why' : null;
  const t = topic(l);
  let best: { a: FormAnswer; s: number } | null = null;
  for (const a of answers) {
    if (a.gap || !a.answer.trim()) continue;
    let s = similarity(l, a.question);
    if (t && topic(norm(a.question)) === t) s += 0.6;
    if (!best || s > best.s) best = { a, s };
  }
  return best && best.s >= 0.5 ? best.a : null;
}

function pickOption(options: string[], value: string): string | null {
  const v = norm(value);
  return options.find((o) => norm(o) === v) ?? options.find((o) => v.startsWith(norm(o)) || norm(o).startsWith(v)) ?? null;
}

/**
 * Deterministic mapping of form fields to approved data. Fields it can't map are returned as
 * unresolved; the caller may ask the model to map them onto the same approved answers, never to invent.
 */
export function mapFields(fields: FormField[], d: ApplyData): { values: Map<string, FieldValue>; unresolved: FormField[] } {
  const values = new Map<string, FieldValue>();
  const unresolved: FormField[] = [];
  for (const f of fields) {
    const l = norm(f.label);
    if (f.kind === 'password') continue; // never type passwords (spec §2.5)
    if (f.kind === 'file') {
      if (/cover|anschreiben|motivation|lettre|carta|lettera/u.test(l) && d.letterPath) values.set(f.id, { kind: 'file', path: d.letterPath, source: 'document.cover_letter' });
      else if (/resume|cv|lebenslauf|curriculum|curriculo/u.test(l) && d.cvPath) values.set(f.id, { kind: 'file', path: d.cvPath, source: 'document.cv' });
      else unresolved.push(f);
      continue;
    }
    if (f.kind === 'checkbox') {
      unresolved.push(f); // consents and declarations are the user's decision
      continue;
    }
    if (f.kind === 'textarea' && /cover letter|additional information|anschreiben|lettre de motivation|carta de presentacion|comments/u.test(l) && d.letterText) {
      values.set(f.id, { kind: 'text', value: d.letterText, source: 'document.cover_letter' });
      continue;
    }
    const rule = RULES.find((r) => r.re.test(l) && (!r.kinds || r.kinds.includes(f.kind)));
    const ruled = rule?.get(d);
    if (rule && ruled && (f.kind !== 'select' && f.kind !== 'radio')) {
      values.set(f.id, { kind: 'text', value: ruled, source: rule.source });
      continue;
    }
    const ans = answerFor(f.label, d.answers);
    if (ans) {
      if (f.kind === 'select' || f.kind === 'radio') {
        const opt = pickOption(f.options, ans.answer);
        if (opt) values.set(f.id, { kind: 'option', value: opt, source: `answer:${ans.question}` });
        else unresolved.push(f);
      } else {
        values.set(f.id, { kind: 'text', value: ans.answer, source: `answer:${ans.question}` });
      }
      continue;
    }
    unresolved.push(f);
  }
  return { values, unresolved };
}

export interface SubmitPolicyInput {
  level: 'off' | 'prepare' | 'submit';
  score: number | null;
  minScore: number;
  packageApproved: boolean;
  autoApprovePackages: boolean;
  host: string;
  excludedDomains: string[];
  submittedToday: number;
  dailyCap: number;
  blocker: string | null;
  unresolvedRequired: number;
}

/**
 * Spec §5.6 level 3: submit automatically only when every condition holds; otherwise prepare and hand
 * over (level 2). Pure function so the rules are unit-tested.
 */
export function canAutoSubmit(p: SubmitPolicyInput): { submit: boolean; reason: string } {
  const h = p.host.toLowerCase();
  if (p.excludedDomains.some((d) => h === d || h.endsWith(`.${d}`))) return { submit: false, reason: 'excluded_site' };
  if (p.level !== 'submit') return { submit: false, reason: 'policy' };
  if (p.blocker) return { submit: false, reason: p.blocker };
  if (p.unresolvedRequired > 0) return { submit: false, reason: 'unknown_fields' };
  if (!p.packageApproved && !p.autoApprovePackages) return { submit: false, reason: 'not_approved' };
  if (p.score === null || p.score < p.minScore) return { submit: false, reason: 'policy' };
  if (p.submittedToday >= p.dailyCap) return { submit: false, reason: 'policy' };
  return { submit: true, reason: 'all conditions met' };
}
