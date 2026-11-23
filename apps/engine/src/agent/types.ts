import type { z } from 'zod';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { TaskName } from '@jobhunter/shared';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Cost reported by the backend (the Agent SDK estimates it), if any. */
  reportedCostUsd: number | null;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reportedCostUsd: a.reportedCostUsd === null && b.reportedCostUsd === null ? null : (a.reportedCostUsd ?? 0) + (b.reportedCostUsd ?? 0),
  };
}

/** One model call (or agent loop) with a typed, schema-validated result. */
export interface BackendRequest {
  task: TaskName;
  model: string;
  system: string;
  prompt: string;
  /** JSON Schema the final answer must follow. */
  jsonSchema: Record<string, unknown>;
  /** MCP servers for agent loops. Empty = single-shot. */
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  /** Built-in web tools for discovery (WebSearch/WebFetch). */
  webTools?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface BackendResponse {
  /** Parsed JSON (not yet validated with Zod). */
  json: unknown;
  rawText: string;
  usage: Usage;
  model: string;
}

export interface LlmBackend {
  readonly name: string;
  run(req: BackendRequest): Promise<BackendResponse>;
}

export class TaskError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'validation' | 'budget' | 'refusal' | 'backend' | 'aborted' | 'config',
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface TaskDef<I, O> {
  name: TaskName;
  /** Prompt file name in apps/engine/prompts (without .md). */
  prompt: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Render the user message from the input. Defaults to pretty JSON. */
  render?: (input: I) => string;
  /** Deterministic checks after Zod validation (e.g. cited fact IDs exist). Return error strings. */
  check?: (output: O, input: I) => string[];
  maxTokens?: number;
  /** Extra prompt variables this task's prompt requires (checked by the prompt harness). */
  promptVars?: string[];
}
