import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { ESSENTIAL_TASKS, estimateCostUsd, modelForTask, type Settings, type TaskName } from '@jobhunter/shared';
import { eq, getSettings, gte, notifications, sql, taskRuns, and } from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { scrubSecrets } from '../logger.js';
import { notify } from '../notify.js';
import { AgentSdkBackend, agentWorkDir } from './backends/agent-sdk.js';
import { MessagesBackend } from './backends/messages.js';
import { claudeEnv } from './claude-cli.js';
import { renderPrompt } from './prompts.js';
import { toModelJsonSchema } from './schema.js';
import { TaskError, ZERO_USAGE, addUsage, type LlmBackend, type TaskDef, type Usage } from './types.js';

export interface ToolSet {
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
}

export interface RunOptions {
  vars?: Record<string, string>;
  tools?: ToolSet;
  webTools?: boolean;
  maxTurns?: number;
  applicationId?: number | null;
  signal?: AbortSignal;
  /** Override the routed model (used by tests and the "Test connection" button). */
  model?: string;
}

export type TaskResult<O> =
  | { ok: true; output: O; usage: Usage; model: string; runId: number; costUsd: number }
  | { ok: false; error: TaskError; usage: Usage; runId: number };

type BackendSelector = (ctx: AppContext, settings: Settings, needsAgentLoop: boolean) => Promise<LlmBackend>;

const overrides = new WeakMap<AppContext, LlmBackend>();

/** Tests (and the prompt harness) route every task to a fixed backend. */
export function setBackendOverride(ctx: AppContext, backend: LlmBackend | null): void {
  if (backend) overrides.set(ctx, backend);
  else overrides.delete(ctx);
}

async function secretsFor(ctx: AppContext) {
  const [apiKey, compatibleKey] = await Promise.all([ctx.secrets.get('anthropic_api_key'), ctx.secrets.get('compatible_api_key')]);
  return { apiKey, compatibleKey };
}

export const selectBackend: BackendSelector = async (ctx, settings, needsAgentLoop) => {
  const forced = overrides.get(ctx);
  if (forced) return forced;
  const mode = settings.auth.mode;
  const { apiKey, compatibleKey } = await secretsFor(ctx);
  const env = async () => claudeEnv(ctx.config, mode, { apiKey, compatibleKey, compatibleBaseUrl: settings.auth.compatibleBaseUrl });
  const sdk = () => new AgentSdkBackend(agentWorkDir(ctx.config.dataDir), env);
  if (mode === 'subscription') return sdk();
  if (mode === 'api_key') {
    if (!apiKey) throw new TaskError('No Anthropic API key saved. Add one in Settings → Claude account.', 'config');
    return needsAgentLoop ? sdk() : new MessagesBackend({ apiKey }, true);
  }
  // compatible / openai_proxy
  if (!compatibleKey || !settings.auth.compatibleBaseUrl) {
    throw new TaskError('The compatible endpoint needs a base URL and a key. Add them in Settings → Claude account.', 'config');
  }
  return needsAgentLoop ? sdk() : new MessagesBackend({ authToken: compatibleKey, baseURL: settings.auth.compatibleBaseUrl }, false);
};

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function spentThisMonth(ctx: AppContext): number {
  const row = ctx.db
    .select({ total: sql<number>`coalesce(sum(${taskRuns.costUsd}), 0)` })
    .from(taskRuns)
    .where(gte(taskRuns.startedAt, monthStartIso()))
    .get();
  return row?.total ?? 0;
}

/** Spec §3.4: once the monthly budget is reached, non-essential tasks pause and the user is told once. */
export function budgetAllows(ctx: AppContext, settings: Settings, task: TaskName): boolean {
  const budget = settings.monthlyBudgetUsd;
  if (budget === null || ESSENTIAL_TASKS.has(task)) return true;
  if (spentThisMonth(ctx) < budget) return true;
  const already = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.kind, 'budget'), gte(notifications.createdAt, monthStartIso())))
    .get();
  if (!already?.n) {
    notify(ctx, {
      kind: 'budget',
      title: 'Monthly budget reached',
      body: `Estimated spend reached $${budget.toFixed(2)}. Scans, discovery and auto-drafting are paused until next month or until you raise the budget.`,
      link: '/settings',
      urgent: true,
    });
  }
  return false;
}

function formatIssues(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    return (err as { issues: { path: (string | number)[]; message: string }[] }).issues
      .slice(0, 12)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return String(err);
}

/**
 * Runs a typed task: routes it to a model, renders its prompt, validates the answer with Zod,
 * retries once with the validation errors, and records usage in task_runs (spec §3.3).
 */
export async function runTask<I, O>(ctx: AppContext, def: TaskDef<I, O>, input: I, opts: RunOptions = {}): Promise<TaskResult<O>> {
  const settings = getSettings(ctx.db);
  const model = opts.model ?? modelForTask(settings, def.name);
  const started = Date.now();
  const run = ctx.db
    .insert(taskRuns)
    .values({ task: def.name, status: 'running', model, applicationId: opts.applicationId ?? null })
    .returning({ id: taskRuns.id })
    .get();
  ctx.bus.invalidate('task-runs');

  const finish = (status: 'succeeded' | 'failed' | 'skipped', usage: Usage, attempts: number, runner: string | null, error?: string) => {
    const cost = usage.reportedCostUsd ?? estimateCostUsd(settings.prices, model, usage);
    ctx.db
      .update(taskRuns)
      .set({
        status,
        attempts,
        runner,
        error: error ? scrubSecrets(error).slice(0, 2000) : null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: cost,
        durationMs: Date.now() - started,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(taskRuns.id, run.id))
      .run();
    ctx.bus.invalidate('task-runs', 'usage');
    return cost;
  };

  if (!budgetAllows(ctx, settings, def.name)) {
    const error = new TaskError('Paused: monthly budget reached', 'budget');
    finish('skipped', ZERO_USAGE, 0, null, error.message);
    return { ok: false, error, usage: ZERO_USAGE, runId: run.id };
  }

  let usage: Usage = ZERO_USAGE;
  let attempts = 0;
  let backendName: string | null = null;
  try {
    const parsedInput = def.input.parse(input);
    const jsonSchema = toModelJsonSchema(def.output);
    const { text: system } = renderPrompt(def.prompt, {
      language: settings.language,
      style_profile: '',
      ...opts.vars,
      output_schema: JSON.stringify(jsonSchema, null, 2),
    });
    const basePrompt = def.render ? def.render(parsedInput) : JSON.stringify(parsedInput, null, 2);
    const needsLoop = Boolean(opts.tools) || Boolean(opts.webTools);
    const backend = await selectBackend(ctx, settings, needsLoop);
    backendName = backend.name;
    let prompt = basePrompt;
    let lastError = '';
    while (attempts < 2) {
      attempts++;
      const res = await backend.run({
        task: def.name,
        model,
        system,
        prompt,
        jsonSchema,
        ...(opts.tools ? { mcpServers: opts.tools.mcpServers, allowedTools: opts.tools.allowedTools } : {}),
        webTools: opts.webTools ?? false,
        maxTurns: opts.maxTurns,
        maxTokens: def.maxTokens,
        signal: opts.signal,
        ...(settings.monthlyBudgetUsd !== null && !ESSENTIAL_TASKS.has(def.name)
          ? { maxBudgetUsd: Math.max(0.05, settings.monthlyBudgetUsd - spentThisMonth(ctx)) }
          : {}),
      });
      usage = addUsage(usage, res.usage);
      const parsed = def.output.safeParse(res.json);
      if (parsed.success) {
        const problems = def.check?.(parsed.data, parsedInput) ?? [];
        if (problems.length === 0) {
          const cost = finish('succeeded', usage, attempts, backendName);
          return { ok: true, output: parsed.data, usage, model: res.model, runId: run.id, costUsd: cost };
        }
        lastError = problems.join('; ');
      } else {
        lastError = res.json === null ? 'The answer was not valid JSON.' : formatIssues(parsed.error);
      }
      prompt = `${basePrompt}\n\n---\nYour previous answer was rejected: ${lastError}\nReturn a corrected answer that follows the schema and the rules exactly.`;
    }
    throw new TaskError(`Invalid model output after retry: ${lastError}`, 'validation');
  } catch (err) {
    const error = err instanceof TaskError ? err : new TaskError(err instanceof Error ? err.message : String(err), 'backend', err);
    ctx.log.warn({ task: def.name, kind: error.kind, err: scrubSecrets(error.message) }, 'task failed');
    finish('failed', usage, attempts, backendName, error.message);
    return { ok: false, error, usage, runId: run.id };
  }
}

/** Splits items into batches so small tasks don't start one Claude process per item (subscription mode). */
export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function batchSize(settings: Settings, task: TaskName): number {
  const sub = settings.auth.mode === 'subscription';
  if (task === 'email_classify') return sub ? 20 : 10;
  if (task === 'match_score') return sub ? 10 : 5;
  if (task === 'alert_parse') return sub ? 5 : 3;
  return 1;
}
