import { z } from 'zod';
import type { TaskDef } from '../agent/types.js';

export const FormFillInput = z.object({
  company: z.string(),
  title: z.string(),
  fields: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(), options: z.array(z.string()), required: z.boolean() })).min(1),
  answers: z.array(z.object({ index: z.number().int(), question: z.string(), answer: z.string() })),
});
export type FormFillInputT = z.infer<typeof FormFillInput>;
export const FormFillOutput = z.object({
  mappings: z.array(z.object({ fieldId: z.string(), answerIndex: z.number().int().nullable(), value: z.string().nullable() })),
});
export type FormFillOutputT = z.infer<typeof FormFillOutput>;

/**
 * Maps form fields the rules couldn't place onto the user's approved answers (spec §5.6: "answers the
 * questions using the approved form answers only. Anything unknown is left empty and flagged").
 */
export const formFillTask: TaskDef<FormFillInputT, FormFillOutputT> = {
  name: 'form_fill',
  prompt: 'form_fill',
  input: FormFillInput,
  output: FormFillOutput,
  render: (i) =>
    [
      `Application: ${i.title} at ${i.company}`,
      '<approved_answers>',
      ...i.answers.map((a) => `[${a.index}] Q: ${a.question}\n    A: ${a.answer}`),
      '</approved_answers>',
      '<fields>',
      ...i.fields.map((f) => `${f.id} (${f.kind}${f.required ? ', required' : ''}): ${f.label}${f.options.length ? ` — options: ${f.options.join(' | ')}` : ''}`),
      '</fields>',
    ].join('\n'),
  check: (o, i) => {
    const problems: string[] = [];
    for (const m of o.mappings) {
      const f = i.fields.find((x) => x.id === m.fieldId);
      if (!f) {
        problems.push(`unknown field ${m.fieldId}`);
        continue;
      }
      if (m.value === null) continue;
      const a = i.answers.find((x) => x.index === m.answerIndex);
      if (!a) {
        problems.push(`field ${m.fieldId} has a value but no approved answer`);
        continue;
      }
      if (f.options.length) {
        if (!f.options.includes(m.value)) problems.push(`field ${m.fieldId}: value must be one of the options`);
      } else if (m.value !== a.answer) {
        problems.push(`field ${m.fieldId}: free-text value must be the approved answer verbatim`);
      }
    }
    return problems;
  },
  maxTokens: 3000,
};
