import { z } from 'zod';
import { EmailClassSchema } from '@jobhunter/shared';
import type { TaskDef } from '../agent/types.js';

export const ClassifyInput = z.object({
  emails: z.array(z.object({ key: z.string(), from: z.string(), subject: z.string(), date: z.string(), text: z.string() })).min(1),
  applications: z.array(z.object({ company: z.string(), title: z.string() })),
});
export type ClassifyInputT = z.infer<typeof ClassifyInput>;
export const ClassifyOutput = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      classification: EmailClassSchema,
      company: z.string().nullable(),
      role: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      keySentence: z.string().nullable(),
      referenceIds: z.array(z.string()),
    }),
  ),
});
export type ClassifyOutputT = z.infer<typeof ClassifyOutput>;

export const emailClassifyTask: TaskDef<ClassifyInputT, ClassifyOutputT> = {
  name: 'email_classify',
  prompt: 'email_classify',
  input: ClassifyInput,
  output: ClassifyOutput,
  render: (i) =>
    [
      '<my_applications>',
      ...i.applications.map((a) => `- ${a.company}: ${a.title}`),
      '</my_applications>',
      ...i.emails.map((e) => `<email key="${e.key}">\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.text}\n</email>`),
    ].join('\n'),
  check: (o, i) => {
    const want = i.emails.map((e) => e.key);
    const got = o.results.map((r) => r.key);
    const problems = want.filter((k) => !got.includes(k)).map((k) => `missing result for email ${k}`);
    for (const r of o.results) {
      const e = i.emails.find((x) => x.key === r.key);
      if (e && r.keySentence && !`${e.subject}\n${e.text}`.toLowerCase().includes(r.keySentence.toLowerCase().slice(0, 40))) {
        problems.push(`keySentence for email ${r.key} must be quoted from the email`);
      }
    }
    return problems;
  },
  maxTokens: 6000,
};

export const AlertInput = z.object({ from: z.string(), subject: z.string(), text: z.string() });
export const AlertOutput = z.object({
  jobs: z.array(z.object({ title: z.string(), company: z.string(), location: z.string().nullable(), url: z.string().nullable() })),
});

export const alertParseTask: TaskDef<z.infer<typeof AlertInput>, z.infer<typeof AlertOutput>> = {
  name: 'alert_parse',
  prompt: 'alert_parse',
  input: AlertInput,
  output: AlertOutput,
  render: (i) => `From: ${i.from}\nSubject: ${i.subject}\n\n${i.text}`,
  check: (o, i) => {
    const text = i.text.toLowerCase();
    return o.jobs.flatMap((j) => [
      ...(text.includes(j.title.toLowerCase().slice(0, 30)) ? [] : [`title "${j.title}" is not in the email`]),
      ...(j.url && !i.text.includes(j.url) ? [`url ${j.url} is not in the email`] : []),
    ]);
  },
  maxTokens: 4000,
};
