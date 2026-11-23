import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ClaudeStatus } from '@jobhunter/shared';
import { desc, getSettings, gte, sql, taskRuns, updateSettings } from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { parse } from '../server/http.js';
import { registerService } from '../services.js';
import { claudeEnv, subscriptionStatus } from './claude-cli.js';
import { monthStartIso, runTask } from './runner.js';
import { connectionTestTask } from '../tasks/connection-test.js';

export async function refreshClaudeStatus(ctx: AppContext): Promise<ClaudeStatus> {
  const settings = getSettings(ctx.db);
  const mode = settings.auth.mode;
  let status: ClaudeStatus;
  if (mode === 'subscription') {
    status = await subscriptionStatus(ctx.config, claudeEnv(ctx.config, 'subscription', {}));
  } else if (mode === 'api_key') {
    const has = await ctx.secrets.has('anthropic_api_key');
    status = { mode, connected: has, detail: has ? 'API key saved in your keychain' : 'No API key saved' };
  } else {
    const has = (await ctx.secrets.has('compatible_api_key')) && !!settings.auth.compatibleBaseUrl;
    status = {
      mode,
      connected: has,
      detail: has ? `Endpoint ${settings.auth.compatibleBaseUrl}` : 'Base URL and key required',
    };
  }
  ctx.runtime.claude = status;
  ctx.bus.invalidate('claude-status', 'summary');
  return status;
}

registerService({
  name: 'claude-status',
  start: (ctx) => {
    void refreshClaudeStatus(ctx).catch((err: unknown) => ctx.log.warn({ err }, 'claude status check failed'));
  },
});

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/claude/status', async () => refreshClaudeStatus(ctx));

  app.post('/api/claude/mode', async (req) => {
    const body = parse(
      z.object({
        mode: z.enum(['subscription', 'api_key', 'compatible', 'openai_proxy']),
        compatibleBaseUrl: z.string().url().nullable().optional(),
      }),
      req.body,
    );
    updateSettings(ctx.db, {
      auth: { mode: body.mode, ...(body.compatibleBaseUrl !== undefined ? { compatibleBaseUrl: body.compatibleBaseUrl } : {}) },
    });
    return refreshClaudeStatus(ctx);
  });

  app.put('/api/claude/api-key', async (req) => {
    const { key, kind } = parse(z.object({ key: z.string().min(10).max(500), kind: z.enum(['anthropic', 'compatible']).default('anthropic') }), req.body);
    await ctx.secrets.set(kind === 'anthropic' ? 'anthropic_api_key' : 'compatible_api_key', key.trim());
    return refreshClaudeStatus(ctx);
  });

  app.delete('/api/claude/api-key', async () => {
    await ctx.secrets.delete('anthropic_api_key');
    await ctx.secrets.delete('compatible_api_key');
    return refreshClaudeStatus(ctx);
  });

  app.post('/api/claude/test', async () => {
    const r = await runTask(ctx, connectionTestTask, { greeting: 'Hello from Jobhunter' });
    if (r.ok) return { ok: true, reply: r.output.reply, model: r.model, costUsd: r.costUsd };
    return { ok: false, error: r.error.message, kind: r.error.kind };
  });

  app.get('/api/task-runs', async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return ctx.db.select().from(taskRuns).orderBy(desc(taskRuns.id)).limit(limit).all();
  });

  app.get('/api/usage', async () => {
    const since = monthStartIso();
    const byTask = ctx.db
      .select({
        task: taskRuns.task,
        runs: sql<number>`count(*)`,
        failed: sql<number>`sum(case when ${taskRuns.status} = 'failed' then 1 else 0 end)`,
        inputTokens: sql<number>`sum(${taskRuns.inputTokens})`,
        outputTokens: sql<number>`sum(${taskRuns.outputTokens})`,
        costUsd: sql<number>`sum(${taskRuns.costUsd})`,
      })
      .from(taskRuns)
      .where(gte(taskRuns.startedAt, since))
      .groupBy(taskRuns.task)
      .all();
    const settings = getSettings(ctx.db);
    const total = byTask.reduce((a, b) => a + (b.costUsd ?? 0), 0);
    return { since, byTask, totalUsd: total, budgetUsd: settings.monthlyBudgetUsd, mode: settings.auth.mode };
  });
}
