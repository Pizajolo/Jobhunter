/**
 * Prompt test harness (spec §6).
 *   pnpm test:prompts            replay recorded outputs (CI, no network)
 *   pnpm test:prompts --live     call the configured model for each case (needs a Claude login or key)
 *   pnpm test:prompts --live --record   also overwrite the recorded outputs
 *   pnpm test:prompts --task match_score   only one task
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from '../src/tasks/index.js';
import { renderPrompt, listPrompts } from '../src/agent/prompts.js';
import { toModelJsonSchema } from '../src/agent/schema.js';
import { checkAssertions, type Cassette } from '../src/agent/cassette.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturesDir = join(root, 'fixtures/llm');
const args = process.argv.slice(2);
const live = args.includes('--live');
const record = args.includes('--record');
const only = args.includes('--task') ? args[args.indexOf('--task') + 1] : undefined;

let failures = 0;
let passed = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};

// 1. Every prompt renders with its schema and has the required sections.
for (const name of listPrompts()) {
  if (only && name !== only) continue;
  const task = TASKS[name];
  if (!task) {
    fail(`prompt ${name}.md has no task definition`);
    continue;
  }
  try {
    const { text } = renderPrompt(name, {
      language: 'en',
      style_profile: '(style profile)',
      output_schema: JSON.stringify(toModelJsonSchema(task.output)),
      ...Object.fromEntries(task.promptVars?.map((v) => [v, `(${v})`]) ?? []),
    });
    if (!/# Role and goal/u.test(text)) fail(`${name}: missing "# Role and goal"`);
    if (!text.includes('"type"')) fail(`${name}: output schema not rendered`);
    passed++;
  } catch (err) {
    fail(`${name}: ${(err as Error).message}`);
  }
}

// 2. Cassettes: recorded (or live) outputs must validate and satisfy assertions.
let liveRunner: ((task: string, c: Cassette) => Promise<unknown>) | null = null;
if (live) {
  const { createLiveRunner } = await import('../src/agent/cassette-live.js');
  liveRunner = await createLiveRunner();
}

if (existsSync(fixturesDir)) {
  for (const taskName of readdirSync(fixturesDir)) {
    if (only && taskName !== only) continue;
    const task = TASKS[taskName];
    if (!task) {
      fail(`fixtures/llm/${taskName} has no task definition`);
      continue;
    }
    for (const file of readdirSync(join(fixturesDir, taskName)).filter((f) => f.endsWith('.json'))) {
      const path = join(fixturesDir, taskName, file);
      const c = JSON.parse(readFileSync(path, 'utf8')) as Cassette;
      const label = `${taskName}/${file}`;
      try {
        const input = task.input.parse(c.input);
        const output = liveRunner ? await liveRunner(taskName, c) : c.output;
        const parsed = task.output.safeParse(output);
        if (!parsed.success) {
          fail(`${label}: output does not match schema: ${parsed.error.message.slice(0, 400)}`);
          continue;
        }
        const problems = [...(task.check?.(parsed.data, input) ?? []), ...checkAssertions(parsed.data, c.assert ?? [])];
        if (problems.length) {
          fail(`${label}: ${problems.join('; ')}`);
          continue;
        }
        if (live && record) writeFileSync(path, `${JSON.stringify({ ...c, output: parsed.data }, null, 2)}\n`);
        passed++;
      } catch (err) {
        fail(`${label}: ${(err as Error).message}`);
      }
    }
  }
}

console.log(`\nPrompt tests: ${passed} passed, ${failures} failed${live ? ' (live)' : ' (replay)'}`);
process.exit(failures ? 1 : 0);
