import { z } from 'zod';
import { SearchProfileSchema } from '@jobhunter/shared';
import type { TaskDef } from '../agent/types.js';

// ---------- Careers page extraction ----------

export const JobExtractInput = z.object({
  url: z.string(),
  text: z.string(),
  links: z.array(z.object({ text: z.string(), href: z.string() })),
});
export const JobExtractOutput = z.object({
  jobs: z.array(z.object({ title: z.string(), location: z.string().nullable(), url: z.string().nullable(), description: z.string().nullable() })),
  nextPageUrl: z.string().nullable(),
});

export const jobExtractTask: TaskDef<z.infer<typeof JobExtractInput>, z.infer<typeof JobExtractOutput>> = {
  name: 'job_extract',
  prompt: 'job_extract',
  input: JobExtractInput,
  output: JobExtractOutput,
  render: (i) =>
    `Page URL: ${i.url}\n\n<page_text>\n${i.text}\n</page_text>\n\n<links>\n${i.links.map((l) => `${l.text} -> ${l.href}`).join('\n')}\n</links>`,
  check: (o, i) => {
    const hrefs = new Set(i.links.map((l) => l.href));
    const text = i.text.toLowerCase();
    const problems: string[] = [];
    for (const j of o.jobs) {
      if (j.url && !hrefs.has(j.url)) problems.push(`url ${j.url} is not one of the page links`);
      if (!text.includes(j.title.toLowerCase().slice(0, 25)) && ![...i.links].some((l) => l.text.toLowerCase().includes(j.title.toLowerCase().slice(0, 25)))) {
        problems.push(`title "${j.title}" is not on the page`);
      }
    }
    if (o.nextPageUrl && !hrefs.has(o.nextPageUrl)) problems.push('nextPageUrl must be one of the page links');
    return problems.slice(0, 8);
  },
  maxTokens: 8000,
};

// ---------- Match scoring ----------

export const MatchInput = z.object({
  candidate: z.object({ summary: z.string(), facts: z.array(z.string()) }),
  search: SearchProfileSchema,
  jobs: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string(),
      remote: z.string(),
      salary: z.string().nullable(),
      description: z.string(),
    }),
  ),
});
export type MatchInputT = z.infer<typeof MatchInput>;
export const MatchOutput = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      score: z.number().int().min(0).max(100),
      reasons: z.array(z.string()).max(5),
      gaps: z.array(z.string()).max(5),
    }),
  ),
});
export type MatchOutputT = z.infer<typeof MatchOutput>;

export const matchScoreTask: TaskDef<MatchInputT, MatchOutputT> = {
  name: 'match_score',
  prompt: 'match_score',
  input: MatchInput,
  output: MatchOutput,
  render: (i) =>
    [
      '<candidate>',
      i.candidate.summary,
      'Confirmed facts:',
      ...i.candidate.facts.map((f) => `- ${f}`),
      '</candidate>',
      '<search_profile>',
      JSON.stringify(i.search),
      '</search_profile>',
      ...i.jobs.map(
        (j) =>
          `<job key="${j.key}">\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location} (${j.remote})\nSalary: ${j.salary ?? 'not stated'}\n${j.description}\n</job>`,
      ),
    ].join('\n'),
  check: (o, i) => {
    const want = new Set(i.jobs.map((j) => j.key));
    const got = o.results.map((r) => r.key);
    const missing = [...want].filter((k) => !got.includes(k));
    const extra = got.filter((k) => !want.has(k));
    return [...missing.map((k) => `missing result for job ${k}`), ...extra.map((k) => `unknown job key ${k}`)];
  },
  maxTokens: 8000,
};

// ---------- Chat: answers + confirmed changes ----------

export const ProposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('search_profile'), summary: z.string(), searchProfile: SearchProfileSchema }),
  z.object({
    kind: z.literal('add_companies'),
    summary: z.string(),
    companies: z.array(z.object({ name: z.string(), careersUrl: z.string().nullable() })).min(1).max(20),
  }),
  z.object({
    kind: z.literal('settings'),
    summary: z.string(),
    changes: z.object({
      scanTime: z.string().nullable(),
      matchThresholdShow: z.number().nullable(),
      noResponseAfterDays: z.number().nullable(),
      discoveryEnabled: z.boolean().nullable(),
      applicationLanguage: z.string().nullable(),
    }),
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

export const ChatInput = z.object({
  message: z.string(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string(),
  searchProfile: SearchProfileSchema,
  today: z.string(),
});
export type ChatInputT = z.infer<typeof ChatInput>;
export const ChatOutput = z.object({ reply: z.string(), proposal: ProposalSchema });
export type ChatOutputT = z.infer<typeof ChatOutput>;

const renderChat = (i: ChatInputT) =>
  [
    `Today: ${i.today}`,
    '<context>',
    i.context,
    '</context>',
    '<current_search_profile>',
    JSON.stringify(i.searchProfile),
    '</current_search_profile>',
    '<conversation>',
    ...i.history.map((m) => `${m.role}: ${m.content}`),
    '</conversation>',
    `user: ${i.message}`,
  ].join('\n');

export const chatTask: TaskDef<ChatInputT, ChatOutputT> = {
  name: 'chat',
  prompt: 'chat',
  input: ChatInput,
  output: ChatOutput,
  render: renderChat,
  maxTokens: 4000,
};

export const searchProfileChatTask: TaskDef<ChatInputT, ChatOutputT> = {
  name: 'search_profile_chat',
  prompt: 'search_profile_chat',
  input: ChatInput,
  output: ChatOutput,
  render: renderChat,
  maxTokens: 4000,
};
