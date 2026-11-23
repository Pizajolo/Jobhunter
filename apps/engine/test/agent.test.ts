import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notifications, taskRuns, updateSettings } from '@jobhunter/db';
import { createTestContext } from '../src/context.js';
import { runTask, setBackendOverride, selectBackend, batches } from '../src/agent/runner.js';
import { FakeBackend } from '../src/agent/backends/fake.js';
import { connectionTestTask } from '../src/tasks/connection-test.js';
import { toModelJsonSchema, extractJson } from '../src/agent/schema.js';
import { claudeEnv } from '../src/agent/claude-cli.js';
import { renderPrompt } from '../src/agent/prompts.js';
import { TaskError } from '../src/agent/types.js';
import { DEFAULT_SETTINGS } from '@jobhunter/shared';

function ctxWithFake() {
  const ctx = createTestContext();
  const fake = new FakeBackend();
  setBackendOverride(ctx, fake);
  return { ctx, fake };
}

describe('agent runner', () => {
  it('runs a task, validates output and records usage', async () => {
    const { ctx, fake } = ctxWithFake();
    fake.on('connection_test', () => ({ ok: true, reply: 'Hi!' }));
    const r = await runTask(ctx, connectionTestTask, { greeting: 'hello' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.reply).toBe('Hi!');
    const run = ctx.db.select().from(taskRuns).all()[0]!;
    expect(run.status).toBe('succeeded');
    expect(run.model).toBe('claude-haiku-5-5');
    expect(run.inputTokens).toBeGreaterThan(0);
    expect(run.costUsd).toBeGreaterThan(0);
    // the prompt carries the JSON schema
    expect(fake.calls[0]!.system).toContain('"reply"');
  });

  it('retries once with the validation error, then succeeds', async () => {
    const { ctx, fake } = ctxWithFake();
    fake.on('connection_test', () => ({ ok: 'yes' }), () => ({ ok: true, reply: 'fixed' }));
    const r = await runTask(ctx, connectionTestTask, { greeting: 'hello' });
    expect(r.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.prompt).toContain('previous answer was rejected');
    expect(ctx.db.select().from(taskRuns).all()[0]!.attempts).toBe(2);
  });

  it('fails visibly after a second invalid answer', async () => {
    const { ctx, fake } = ctxWithFake();
    fake.on('connection_test', () => ({ nope: 1 }));
    const r = await runTask(ctx, connectionTestTask, { greeting: 'hello' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('validation');
    const run = ctx.db.select().from(taskRuns).all()[0]!;
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/Invalid model output/u);
  });

  it('runs deterministic checks after schema validation', async () => {
    const { ctx, fake } = ctxWithFake();
    fake.on('connection_test', () => ({ ok: false, reply: 'x' }));
    const def = { ...connectionTestTask, check: (o: { ok: boolean }) => (o.ok ? [] : ['ok must be true']) };
    const r = await runTask(ctx, def, { greeting: 'hi' });
    expect(r.ok).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it('pauses non-essential tasks when the monthly budget is reached and notifies once', async () => {
    const { ctx, fake } = ctxWithFake();
    fake.on('match_score', () => ({ results: [] }));
    updateSettings(ctx.db, { monthlyBudgetUsd: 1 });
    ctx.db.insert(taskRuns).values({ task: 'cover_letter', status: 'succeeded', costUsd: 2 }).run();
    const def = { ...connectionTestTask, name: 'match_score' as const };
    const r1 = await runTask(ctx, def, { greeting: 'x' });
    const r2 = await runTask(ctx, def, { greeting: 'x' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.kind).toBe('budget');
    expect(r2.ok).toBe(false);
    expect(ctx.db.select().from(notifications).all()).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
    // essential tasks keep running
    fake.on('connection_test', () => ({ ok: true, reply: 'still here' }));
    expect((await runTask(ctx, connectionTestTask, { greeting: 'x' })).ok).toBe(true);
  });

  it('refuses API-key mode without a key', async () => {
    const ctx = createTestContext();
    updateSettings(ctx.db, { auth: { mode: 'api_key' } });
    await expect(selectBackend(ctx, { ...DEFAULT_SETTINGS, auth: { mode: 'api_key', compatibleBaseUrl: null } }, false)).rejects.toBeInstanceOf(TaskError);
  });

  it('batches items', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('claude environment', () => {
  const config = createTestContext().config;
  it('never passes parent API keys into subscription mode', () => {
    const env = claudeEnv(config, 'subscription', {}, { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-leak', ANTHROPIC_BASE_URL: 'http://evil', CLAUDE_CODE_OAUTH_TOKEN: 'x' });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });
  it('injects the stored key in API-key mode and the endpoint in compatible mode', () => {
    expect(claudeEnv(config, 'api_key', { apiKey: 'sk-ant-1' }, {}).ANTHROPIC_API_KEY).toBe('sk-ant-1');
    const c = claudeEnv(config, 'compatible', { compatibleKey: 'k', compatibleBaseUrl: 'https://api.example.com/anthropic' }, {});
    expect(c.ANTHROPIC_BASE_URL).toBe('https://api.example.com/anthropic');
    expect(c.ANTHROPIC_AUTH_TOKEN).toBe('k');
  });
  it('keeps the Claude login inside the data volume in server mode', () => {
    const env = claudeEnv({ ...config, mode: 'server', dataDir: '/data' }, 'subscription', {}, {});
    expect(env.CLAUDE_CONFIG_DIR).toBe('/data/claude');
  });
});

describe('schemas and prompts', () => {
  it('produces a structured-output friendly JSON schema', () => {
    const s = toModelJsonSchema(z.object({ score: z.number().int().min(0).max(100), tags: z.array(z.string()).max(3), url: z.string().url() }));
    const json = JSON.stringify(s);
    expect(json).not.toContain('maximum');
    expect(json).not.toContain('maxItems');
    expect(s.additionalProperties).toBe(false);
  });
  it('extracts JSON from fenced text', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"b":[1,2]} suffix')).toEqual({ b: [1, 2] });
    expect(() => extractJson('nothing')).toThrow();
  });
  it('fails on missing prompt variables', () => {
    expect(() => renderPrompt('connection_test', {})).toThrow(/missing variables/u);
  });
});
