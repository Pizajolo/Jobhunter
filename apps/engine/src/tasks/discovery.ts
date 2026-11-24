import { z } from 'zod';
import { SearchProfileSchema } from '@jobhunter/shared';
import type { TaskDef } from '../agent/types.js';

export const DiscoveryInput = z.object({
  candidate: z.string(),
  search: SearchProfileSchema,
  /** Companies already watched, suggested or rejected: never suggest these again. */
  known: z.array(z.string()),
  max: z.number().int().min(1).max(20).default(8),
});
export type DiscoveryInputT = z.infer<typeof DiscoveryInput>;

export const DiscoveryOutput = z.object({
  companies: z.array(
    z.object({
      name: z.string().min(1),
      website: z.string().nullable(),
      careersUrl: z.string().nullable(),
      location: z.string().nullable(),
      reason: z.string().min(1),
    }),
  ),
});
export type DiscoveryOutputT = z.infer<typeof DiscoveryOutput>;

/**
 * Weekly company discovery (spec §5.2): the agent uses web search to find employers that fit the
 * search profile and returns them as suggestions with a reason. The user accepts or rejects them.
 */
export const companyDiscoveryTask: TaskDef<DiscoveryInputT, DiscoveryOutputT> = {
  name: 'company_discovery',
  prompt: 'company_discovery',
  input: DiscoveryInput,
  output: DiscoveryOutput,
  render: (i) =>
    [
      '<candidate>',
      i.candidate,
      '</candidate>',
      '<search_profile>',
      JSON.stringify(i.search, null, 2),
      '</search_profile>',
      '<known_companies>',
      i.known.length ? i.known.join('\n') : '(none)',
      '</known_companies>',
      `Suggest at most ${i.max} companies.`,
    ].join('\n'),
  // Only the count is checked here. Known, excluded and LinkedIn entries are dropped one by one when
  // storing (scan/discovery.ts), so one bad entry doesn't cost a whole new agent run.
  check: (o, i) => (o.companies.length > i.max ? [`return at most ${i.max} companies`] : []),
  maxTokens: 4000,
};
