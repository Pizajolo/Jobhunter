import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { query, type HookCallback, type HookJSONOutput, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { registrableDomain } from '@jobhunter/shared';
import type { BackendRequest, BackendResponse, LlmBackend, Usage } from '../types.js';
import { TaskError } from '../types.js';
import { claudeExecutable } from '../claude-cli.js';

const WEB_TOOLS = ['WebSearch', 'WebFetch'];
/** Sites the agent may never fetch or search (spec §2.4: no LinkedIn scraping or automation). */
export const WEB_BLOCKED_DOMAINS = ['linkedin.com', 'lnkd.in'];

const deny = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

/**
 * PreToolUse guard for the web tools: refuses fetches of blocked sites and keeps them out of
 * web searches. Runs inside the Claude Code process before every tool call.
 */
export const webGuard: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const args = (input.tool_input ?? {}) as Record<string, unknown>;
  if (input.tool_name === 'WebFetch') {
    let host: string;
    try {
      host = registrableDomain(new URL(String(args.url ?? '')).hostname);
    } catch {
      return deny('Invalid URL');
    }
    return WEB_BLOCKED_DOMAINS.includes(host) ? deny(`${host} is blocked: Jobhunter never accesses LinkedIn. Use the company's own website.`) : {};
  }
  if (input.tool_name === 'WebSearch') {
    if (/linkedin|lnkd\.in/iu.test(String(args.query ?? ''))) return deny('Searching LinkedIn is not allowed. Search for the company website instead.');
    const allowed = Array.isArray(args.allowed_domains) ? (args.allowed_domains as string[]) : null;
    if (allowed) return allowed.some((d) => WEB_BLOCKED_DOMAINS.includes(registrableDomain(d))) ? deny('LinkedIn is not allowed') : {};
    const blocked = Array.isArray(args.blocked_domains) ? (args.blocked_domains as string[]) : [];
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...args, blocked_domains: [...new Set([...blocked, ...WEB_BLOCKED_DOMAINS])] },
      },
    };
  }
  return {};
};

/**
 * Runs tasks through the Claude Agent SDK (the official Claude Code binary). Used for every task in
 * subscription mode and for agent loops in API-key mode. Built-in file/shell tools are switched off;
 * only Jobhunter's own MCP tools (and web tools for discovery) are available.
 */
export class AgentSdkBackend implements LlmBackend {
  readonly name = 'agent-sdk';
  constructor(
    private readonly workDir: string,
    private readonly env: () => Promise<Record<string, string>>,
  ) {
    mkdirSync(workDir, { recursive: true });
  }

  async run(req: BackendRequest): Promise<BackendResponse> {
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    const mcpToolNames = req.allowedTools ?? [];
    const tools = req.webTools ? WEB_TOOLS : [];
    const env = await this.env();
    let result: SDKResultMessage | null = null;
    let lastText = '';
    try {
      const q = query({
        prompt: req.prompt,
        options: {
          abortController: abort,
          cwd: this.workDir,
          model: req.model,
          systemPrompt: req.system,
          tools,
          allowedTools: [...tools, ...mcpToolNames],
          mcpServers: req.mcpServers ?? {},
          strictMcpConfig: true,
          permissionMode: 'dontAsk',
          settingSources: [],
          skills: [],
          plugins: [],
          persistSession: false,
          maxTurns: req.maxTurns ?? (req.mcpServers ? 30 : 3),
          ...(req.maxBudgetUsd ? { maxBudgetUsd: req.maxBudgetUsd } : {}),
          outputFormat: { type: 'json_schema', schema: req.jsonSchema },
          ...(req.webTools ? { hooks: { PreToolUse: [{ matcher: 'WebFetch|WebSearch', hooks: [webGuard], onFailure: 'block' as const }] } } : {}),
          env,
          ...(process.env.JOBHUNTER_CLAUDE_PATH ? { pathToClaudeCodeExecutable: claudeExecutable(env) } : {}),
        },
      });
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) if (block.type === 'text') lastText = block.text;
        }
        if (msg.type === 'result') result = msg;
      }
    } catch (err) {
      if (abort.signal.aborted) throw new TaskError('Task was cancelled', 'aborted', err);
      const message = err instanceof Error ? err.message : String(err);
      if (/log ?in|auth|credential|401|unauthori[sz]ed/iu.test(message)) {
        throw new TaskError('Claude is not signed in. Run the login command shown in Settings.', 'auth', err);
      }
      throw new TaskError(`Claude Agent SDK error: ${message}`, 'backend', err);
    } finally {
      req.signal?.removeEventListener('abort', onAbort);
    }
    if (!result) throw new TaskError('The agent finished without a result', 'backend');
    const usage = usageFrom(result);
    if (result.subtype !== 'success') {
      const errs = 'errors' in result ? result.errors.join('; ') : '';
      if (result.subtype === 'error_max_budget_usd') throw new TaskError('Task stopped at its budget limit', 'budget');
      if (result.subtype === 'error_max_structured_output_retries') {
        throw new TaskError(`The model did not return valid structured output. ${errs}`, 'validation');
      }
      throw new TaskError(`Agent failed (${result.subtype}). ${errs}`.trim(), 'backend');
    }
    if (result.is_error) {
      if (result.api_error_status === 401) throw new TaskError('Claude rejected the credentials. Sign in again.', 'auth');
      throw new TaskError(`Agent error: ${result.result}`, 'backend');
    }
    const json = result.structured_output ?? tryParse(result.result || lastText);
    return { json, rawText: result.result || lastText, usage, model: Object.keys(result.modelUsage)[0] ?? req.model };
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function usageFrom(r: SDKResultMessage): Usage {
  const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const m of Object.values(r.modelUsage)) {
    u.inputTokens += m.inputTokens;
    u.outputTokens += m.outputTokens;
    u.cacheReadTokens += m.cacheReadInputTokens;
    u.cacheWriteTokens += m.cacheCreationInputTokens;
  }
  return { ...u, reportedCostUsd: r.total_cost_usd };
}

export function agentWorkDir(dataDir: string): string {
  return join(dataDir, 'agent-workdir');
}
