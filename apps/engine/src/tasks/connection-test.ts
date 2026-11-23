import { z } from 'zod';
import type { TaskDef } from '../agent/types.js';

export const connectionTestTask: TaskDef<{ greeting: string }, { ok: boolean; reply: string }> = {
  name: 'connection_test',
  prompt: 'connection_test',
  input: z.object({ greeting: z.string() }),
  output: z.object({ ok: z.boolean(), reply: z.string() }),
  render: (i) => i.greeting,
  maxTokens: 300,
};
