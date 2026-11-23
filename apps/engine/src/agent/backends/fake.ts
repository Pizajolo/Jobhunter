import type { TaskName } from '@jobhunter/shared';
import type { BackendRequest, BackendResponse, LlmBackend } from '../types.js';
import { TaskError } from '../types.js';

export type FakeHandler = (req: BackendRequest) => unknown;

/**
 * Deterministic backend for tests and recorded "cassettes". Handlers return the JSON a model would
 * return; throwing a TaskError simulates provider failures.
 */
export class FakeBackend implements LlmBackend {
  readonly name = 'fake';
  readonly calls: BackendRequest[] = [];
  private readonly handlers = new Map<TaskName, FakeHandler[]>();

  /** Queue responses for a task. A single handler repeats forever; several are used in order. */
  on(task: TaskName, ...handlers: FakeHandler[]): this {
    this.handlers.set(task, handlers);
    return this;
  }

  async run(req: BackendRequest): Promise<BackendResponse> {
    this.calls.push(req);
    const list = this.handlers.get(req.task);
    if (!list?.length) throw new TaskError(`No fake response for task ${req.task}`, 'backend');
    const handler = list.length > 1 ? list.shift()! : list[0]!;
    const json = handler(req);
    const raw = JSON.stringify(json);
    return {
      json,
      rawText: raw,
      model: req.model,
      usage: {
        inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
        outputTokens: Math.ceil(raw.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reportedCostUsd: null,
      },
    };
  }
}
