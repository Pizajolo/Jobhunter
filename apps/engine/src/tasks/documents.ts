import { z } from 'zod';
import { CoverLetterSchema, FormAnswerSchema, TailoredCvSchema, type ProfileFact, type TailoredCv } from '@jobhunter/shared';
import { checkCitations } from '@jobhunter/mcp-docs';
import type { TaskDef } from '../agent/types.js';

const FactInput = z.object({ id: z.string(), text: z.string(), category: z.string().nullable() });
const JobInput = z.object({ title: z.string(), company: z.string(), location: z.string(), description: z.string() });

function factsBlock(facts: { id: string; text: string; category: string | null }[]): string {
  return facts.map((f) => `[${f.id}] (${f.category ?? 'other'}) ${f.text}`).join('\n');
}
function asFacts(facts: { id: string; text: string }[]): ProfileFact[] {
  return facts.map((f) => ({ id: f.id, text: f.text, source: 'cv', confirmedAt: 'x' }));
}

// ---------- CV ----------

export const CvInput = z.object({
  job: JobInput,
  language: z.string(),
  pages: z.union([z.literal(1), z.literal(2)]),
  entries: z.array(z.object({ refId: z.string(), kind: z.enum(['work', 'education', 'project', 'certificate']), label: z.string() })),
  facts: z.array(FactInput),
  sectionTitles: z.record(z.string(), z.string()),
  instruction: z.string().nullable(),
});
export type CvInputT = z.infer<typeof CvInput>;

export const cvTailorTask: TaskDef<CvInputT, TailoredCv> = {
  name: 'cv_tailor',
  prompt: 'cv_tailor',
  promptVars: ['style_profile'],
  input: CvInput,
  output: TailoredCvSchema,
  render: (i) =>
    [
      `Language: ${i.language}`,
      `Target length: ${i.pages} page${i.pages === 1 ? '' : 's'}`,
      `Section titles to use: ${JSON.stringify(i.sectionTitles)}`,
      i.instruction ? `User instruction for this version: ${i.instruction}` : '',
      '<job>',
      `Title: ${i.job.title}\nCompany: ${i.job.company}\nLocation: ${i.job.location}\n${i.job.description}`,
      '</job>',
      '<profile_entries>',
      ...i.entries.map((e) => `${e.refId} (${e.kind}): ${e.label}`),
      '</profile_entries>',
      '<facts>',
      factsBlock(i.facts),
      '</facts>',
    ]
      .filter(Boolean)
      .join('\n'),
  check: (o, i) => {
    const refs = new Set(i.entries.map((e) => e.refId));
    const problems: string[] = [];
    for (const s of o.sections) {
      for (const it of s.items) {
        if ((s.kind === 'experience' || s.kind === 'education') && (!it.refId || !refs.has(it.refId))) {
          problems.push(`${s.kind} item "${it.heading}" must use a refId from <profile_entries>`);
        }
      }
    }
    const items = [
      ...(o.summary ? [{ text: o.summary, factIds: o.summaryFactIds }] : []),
      ...o.sections.flatMap((s) => s.items.flatMap((it) => it.bullets.map((b) => ({ text: b.text, factIds: b.factIds })))),
    ];
    return [...problems, ...checkCitations(items, asFacts(i.facts))];
  },
  maxTokens: 12_000,
};

// ---------- Cover letter ----------

export const LetterInput = z.object({
  job: JobInput,
  language: z.string(),
  applicantName: z.string(),
  facts: z.array(FactInput),
  instruction: z.string().nullable(),
});
export type LetterInputT = z.infer<typeof LetterInput>;
export type CoverLetterT = z.infer<typeof CoverLetterSchema>;

export const coverLetterTask: TaskDef<LetterInputT, CoverLetterT> = {
  name: 'cover_letter',
  prompt: 'cover_letter',
  promptVars: ['style_profile'],
  input: LetterInput,
  output: CoverLetterSchema,
  render: (i) =>
    [
      `Language: ${i.language}`,
      `Applicant: ${i.applicantName}`,
      i.instruction ? `User instruction for this version: ${i.instruction}` : '',
      '<job>',
      `Title: ${i.job.title}\nCompany: ${i.job.company}\nLocation: ${i.job.location}\n${i.job.description}`,
      '</job>',
      '<facts>',
      factsBlock(i.facts),
      '</facts>',
    ]
      .filter(Boolean)
      .join('\n'),
  check: (o, i) => {
    const problems = checkCitations(
      o.paragraphs.map((p) => ({ text: p.text, factIds: p.factIds, optional: p.factIds.length === 0 && !/\d/u.test(p.text) })),
      asFacts(i.facts),
    );
    if (!o.paragraphs.some((p) => p.factIds.length > 0)) problems.push('at least one paragraph must cite facts');
    return problems;
  },
  maxTokens: 6000,
};

// ---------- Form answers ----------

export const AnswersInput = z.object({
  job: JobInput,
  language: z.string(),
  questions: z.array(z.string()).min(1),
  facts: z.array(FactInput),
  preferences: z.object({
    salaryExpectation: z.string().nullable(),
    noticePeriod: z.string().nullable(),
    workAuthorization: z.string().nullable(),
    motivation: z.string().nullable(),
  }),
});
export type AnswersInputT = z.infer<typeof AnswersInput>;
export const AnswersOutput = z.object({ answers: z.array(FormAnswerSchema) });
export type AnswersOutputT = z.infer<typeof AnswersOutput>;

export const formAnswersTask: TaskDef<AnswersInputT, AnswersOutputT> = {
  name: 'form_answers',
  prompt: 'form_answers',
  promptVars: ['style_profile'],
  input: AnswersInput,
  output: AnswersOutput,
  render: (i) =>
    [
      `Language: ${i.language}`,
      '<job>',
      `Title: ${i.job.title}\nCompany: ${i.job.company}\nLocation: ${i.job.location}\n${i.job.description.slice(0, 6000)}`,
      '</job>',
      `<preferences>${JSON.stringify(i.preferences)}</preferences>`,
      '<facts>',
      factsBlock(i.facts),
      '</facts>',
      '<questions>',
      ...i.questions.map((q, n) => `${n + 1}. ${q}`),
      '</questions>',
    ].join('\n'),
  check: (o, i) => {
    const problems: string[] = [];
    if (o.answers.length !== i.questions.length) problems.push(`return exactly ${i.questions.length} answers, one per question, in order`);
    const prefText = Object.values(i.preferences).filter(Boolean).join('\n');
    for (const a of o.answers) {
      if (a.gap) continue;
      const sources = [...a.factIds.map((id) => i.facts.find((f) => f.id === id)?.text ?? ''), prefText];
      const unknown = a.factIds.filter((id) => !i.facts.some((f) => f.id === id));
      if (unknown.length) problems.push(`answer to "${a.question.slice(0, 40)}" cites unknown facts ${unknown.join(', ')}`);
      const nums = (a.answer.match(/(?<![\p{L}\d])\d(?:[\d.,'’]*\d)?/gu) ?? []).filter((n) => !sources.some((s) => s.replace(/[^\d]/gu, ' ').split(/\s+/u).includes(n.replace(/[^\d]/gu, '')) || s.includes(n)));
      if (nums.length) problems.push(`answer to "${a.question.slice(0, 40)}" has unsupported numbers ${nums.join(', ')}`);
    }
    return problems;
  },
  maxTokens: 6000,
};

// ---------- Style rules from edits ----------

export const StyleRulesInput = z.object({
  language: z.string(),
  existing: z.array(z.string()),
  edits: z.array(z.object({ before: z.string(), after: z.string() })).min(1),
});
export const StyleRulesOutput = z.object({ rules: z.array(z.string()).max(5) });

export const styleRulesTask: TaskDef<z.infer<typeof StyleRulesInput>, z.infer<typeof StyleRulesOutput>> = {
  name: 'style_rules',
  prompt: 'style_rules',
  input: StyleRulesInput,
  output: StyleRulesOutput,
  render: (i) =>
    [
      `Language: ${i.language}`,
      `Existing rules:\n${i.existing.map((r) => `- ${r}`).join('\n') || '(none)'}`,
      ...i.edits.map((e, n) => `<edit n="${n + 1}">\n<before>\n${e.before.slice(0, 3000)}\n</before>\n<after>\n${e.after.slice(0, 3000)}\n</after>\n</edit>`),
    ].join('\n'),
  maxTokens: 2000,
};
