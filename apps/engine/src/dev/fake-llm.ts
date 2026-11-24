import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskName } from '@jobhunter/shared';
import { FakeBackend } from '../agent/backends/fake.js';
import type { BackendRequest } from '../agent/types.js';

/**
 * Offline backend for demos and end-to-end tests (JOBHUNTER_FAKE_LLM=1). Answers every task from
 * the recorded cassettes in fixtures/llm, with a few dynamic answers where the output depends on the
 * input (match scores, email classification). Never used unless explicitly enabled.
 */
export function createCassetteBackend(fixturesDir: string): FakeBackend {
  const fake = new FakeBackend();
  const dir = join(fixturesDir, 'llm');
  if (existsSync(dir)) {
    for (const task of readdirSync(dir)) {
      const files = readdirSync(join(dir, task)).filter((f) => f.endsWith('.json'));
      const first = files[0];
      if (!first) continue;
      const out = (JSON.parse(readFileSync(join(dir, task, first), 'utf8')) as { output: unknown }).output;
      fake.on(task as TaskName, () => structuredClone(out));
    }
  }
  fake.on('match_score', (req: BackendRequest) => {
    const keys = [...req.prompt.matchAll(/<job key="(\d+)">\nTitle: ([^\n]+)/gu)];
    return {
      results: keys.map(([, key, title]) => {
        const product = /product|strategy|venture|ai/iu.test(title!);
        return { key: key!, score: product ? 70 + (Number(key) % 25) : 35, reasons: product ? ['Product leadership experience matches the role'] : [], gaps: product ? [] : ['Different role family'] };
      }),
    };
  });
  fake.on('connection_test', () => ({ ok: true, reply: 'Offline demo backend is answering.' }));
  return fake;
}
