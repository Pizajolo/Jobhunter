import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EMPTY_PROFILE, ProfileSchema, type Profile } from '@jobhunter/shared';
import type { TaskDef } from '../agent/types.js';

const s = z.string();
const ns = z.string().nullable();

/** What the model extracts from a CV. IDs are assigned by Jobhunter afterwards. */
export const ExtractionSchema = z.object({
  basics: z.object({
    name: s,
    label: ns,
    email: ns,
    phone: ns,
    url: ns,
    summary: ns,
    city: ns,
    countryCode: ns,
    profiles: z.array(z.object({ network: s, url: s })),
  }),
  work: z.array(
    z.object({
      employer: s,
      position: s,
      location: ns,
      startDate: ns,
      endDate: ns,
      summary: ns,
      highlights: z.array(s),
    }),
  ),
  education: z.array(
    z.object({ institution: s, studyType: ns, area: ns, location: ns, startDate: ns, endDate: ns, score: ns, highlights: z.array(s) }),
  ),
  skills: z.array(z.object({ name: s, level: ns, keywords: z.array(s) })),
  languages: z.array(z.object({ language: s, fluency: ns })),
  projects: z.array(z.object({ name: s, description: ns, url: ns, startDate: ns, endDate: ns, highlights: z.array(s) })),
  certificates: z.array(z.object({ name: s, issuer: ns, date: ns })),
  achievements: z.array(z.object({ text: s, metric: ns })),
  interests: z.array(s),
  detectedLanguage: s,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const opt = (v: string | null): string | undefined => (v && v.trim() ? v.trim() : undefined);
const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

export function extractionToProfile(x: Extraction): Profile {
  return ProfileSchema.parse({
    ...EMPTY_PROFILE,
    basics: {
      name: x.basics.name,
      label: opt(x.basics.label),
      email: opt(x.basics.email),
      phone: opt(x.basics.phone),
      url: opt(x.basics.url),
      summary: opt(x.basics.summary),
      location: x.basics.city || x.basics.countryCode ? { city: opt(x.basics.city), countryCode: opt(x.basics.countryCode) } : undefined,
      profiles: x.basics.profiles,
    },
    work: x.work.map((w) => ({
      id: id('w'),
      name: w.employer,
      position: w.position,
      location: opt(w.location),
      startDate: opt(w.startDate),
      endDate: opt(w.endDate),
      summary: opt(w.summary),
      highlights: w.highlights.filter((h) => h.trim()),
    })),
    education: x.education.map((e) => ({
      id: id('e'),
      institution: e.institution,
      studyType: opt(e.studyType),
      area: opt(e.area),
      location: opt(e.location),
      startDate: opt(e.startDate),
      endDate: opt(e.endDate),
      score: opt(e.score),
      highlights: e.highlights,
    })),
    skills: x.skills.map((k) => ({ id: id('s'), name: k.name, level: opt(k.level), keywords: k.keywords })),
    languages: x.languages.map((l) => ({ id: id('l'), language: l.language, fluency: opt(l.fluency) })),
    projects: x.projects.map((p) => ({
      id: id('p'),
      name: p.name,
      description: opt(p.description),
      url: opt(p.url),
      startDate: opt(p.startDate),
      endDate: opt(p.endDate),
      highlights: p.highlights,
    })),
    certificates: x.certificates.map((c) => ({ id: id('c'), name: c.name, issuer: opt(c.issuer), date: opt(c.date) })),
    achievements: x.achievements.map((a) => ({ id: id('a'), text: a.text, metric: opt(a.metric) })),
    interests: x.interests,
  });
}

function normalize(t: string): string {
  return t.toLowerCase().replace(/\s+/gu, ' ');
}

/** Numbers, but not digits inside words like "B2B" or "0→1" labels. */
const NUM = /(?<![\p{L}\d])\d(?:[\d.,'’]*\d)?/gu;
const digits = (n: string) => n.replace(/[^\d]/gu, '');

/** Numbers that appear in `source`, compared without thousands/decimal separators. */
export function numbersMissingFrom(claim: string, source: string): string[] {
  const have = new Set((source.match(NUM) ?? []).map(digits));
  return (claim.match(NUM) ?? []).filter((n) => !have.has(digits(n)));
}

/**
 * Guard against invented content: every employer and institution must literally appear in the CV text,
 * and numbers in highlights must appear there too.
 */
export function checkExtraction(x: Extraction, input: { text: string }): string[] {
  const text = normalize(input.text);
  const problems: string[] = [];
  for (const w of x.work) if (!text.includes(normalize(w.employer).slice(0, 40))) problems.push(`employer "${w.employer}" is not in the CV text`);
  for (const e of x.education) if (!text.includes(normalize(e.institution).slice(0, 40))) problems.push(`institution "${e.institution}" is not in the CV text`);
  for (const h of [...x.work.flatMap((w) => w.highlights), ...x.achievements.map((a) => a.text)]) {
    for (const num of numbersMissingFrom(h, input.text)) problems.push(`number "${num}" in "${h.slice(0, 60)}" is not in the CV text`);
  }
  return problems.slice(0, 10);
}

export const profileExtractTask: TaskDef<{ text: string; kind: 'cv' | 'linkedin_pdf' }, Extraction> = {
  name: 'profile_extract',
  prompt: 'profile_extract',
  input: z.object({ text: z.string().min(20).max(120_000), kind: z.enum(['cv', 'linkedin_pdf']) }),
  output: ExtractionSchema,
  render: (i) => `Document type: ${i.kind === 'cv' ? 'CV / résumé' : 'LinkedIn profile PDF export'}\n\n<document>\n${i.text}\n</document>`,
  check: checkExtraction,
  maxTokens: 16_000,
};

// ---------- CV interview ----------

export const InterviewTurnSchema = z.object({
  done: z.boolean(),
  question: z.string().nullable(),
  topic: z.string().nullable(),
  why: z.string().nullable(),
});
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;

export const InterviewInputSchema = z.object({
  profileSummary: z.string(),
  facts: z.array(z.object({ id: z.string(), text: z.string() })),
  history: z.array(z.object({ question: z.string(), answer: z.string().nullable(), topic: z.string().nullable() })),
  goals: z.string().nullable(),
});
export type InterviewInput = z.infer<typeof InterviewInputSchema>;

export const cvInterviewTask: TaskDef<InterviewInput, InterviewTurn> = {
  name: 'cv_interview',
  prompt: 'cv_interview',
  input: InterviewInputSchema,
  output: InterviewTurnSchema,
  check: (o) => (!o.done && !o.question ? ['question is required unless done'] : []),
  maxTokens: 1500,
};

export const InterviewSummarySchema = z.object({
  summary: z.string(),
  facts: z.array(z.object({ text: z.string(), category: z.string(), basedOnQuestion: z.number().int() })),
});
export type InterviewSummary = z.infer<typeof InterviewSummarySchema>;

export const interviewSummaryTask: TaskDef<InterviewInput, InterviewSummary> = {
  name: 'interview_summary',
  prompt: 'interview_summary',
  input: InterviewInputSchema,
  output: InterviewSummarySchema,
  check: (o, i) =>
    o.facts.flatMap((f) => {
      const turn = i.history[f.basedOnQuestion];
      if (!turn?.answer) return [`fact "${f.text.slice(0, 50)}" cites question ${f.basedOnQuestion}, which has no answer`];
      return numbersMissingFrom(f.text, turn.answer).map((n) => `number ${n} is not in the answer to question ${f.basedOnQuestion}`);
    }),
  maxTokens: 6000,
};

// ---------- Writing style ----------

export const StyleAnalysisSchema = z.object({
  tone: z.string(),
  formality: z.string(),
  sentenceLength: z.string(),
  typicalPhrases: z.array(z.string()),
  avoid: z.array(z.string()),
  description: z.string(),
  examples: z.array(z.string()),
});
export type StyleAnalysis = z.infer<typeof StyleAnalysisSchema>;

export const styleAnalyzeTask: TaskDef<{ language: string; samples: string[] }, StyleAnalysis> = {
  name: 'style_analyze',
  prompt: 'style_analyze',
  input: z.object({ language: z.string(), samples: z.array(z.string()).min(1).max(30) }),
  output: StyleAnalysisSchema,
  render: (i) => `Language: ${i.language}\n\n${i.samples.map((t, n) => `<sample n="${n + 1}">\n${t.slice(0, 6000)}\n</sample>`).join('\n\n')}`,
  check: (o, i) => {
    const all = i.samples.join('\n').toLowerCase();
    return o.examples.filter((e) => !all.includes(e.toLowerCase().slice(0, 30))).map((e) => `example "${e.slice(0, 40)}" is not quoted from a sample`);
  },
  maxTokens: 4000,
};
