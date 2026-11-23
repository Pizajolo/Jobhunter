import Anthropic from '@anthropic-ai/sdk';
import type { BackendRequest, BackendResponse, LlmBackend } from '../types.js';
import { TaskError } from '../types.js';
import { extractJson } from '../schema.js';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5']);

/**
 * Single-shot structured calls over the Messages API, used in API-key and compatible-endpoint modes.
 * One HTTP request, exact token usage, no subprocess.
 */
export class MessagesBackend implements LlmBackend {
  readonly name = 'messages';
  private readonly client: Anthropic;

  constructor(
    opts: { apiKey?: string; authToken?: string; baseURL?: string },
    private readonly firstParty: boolean,
  ) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? null,
      authToken: opts.authToken ?? null,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 2,
    });
  }

  async run(req: BackendRequest): Promise<BackendResponse> {
    const useFallbacks = this.firstParty && FALLBACK_MODELS.has(req.model);
    const system = this.firstParty
      ? req.system
      : `${req.system}\n\nRespond with a single JSON object that follows this JSON Schema exactly, and nothing else:\n${JSON.stringify(req.jsonSchema)}`;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 16_000,
          system,
          messages: [{ role: 'user', content: req.prompt }],
          ...(this.firstParty ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema } } } : {}),
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal },
      );
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') {
        throw new TaskError('The model declined this request.', 'refusal');
      }
      if (msg.stop_reason === 'max_tokens') {
        throw new TaskError('The answer was cut off (max tokens). Try a shorter input.', 'validation');
      }
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let json: unknown = null;
      try {
        json = extractJson(text);
      } catch {
        json = null;
      }
      return {
        json,
        rawText: text,
        model: msg.model,
        usage: {
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
          reportedCostUsd: null,
        },
      };
    } catch (err) {
      if (err instanceof TaskError) throw err;
      if (err instanceof Anthropic.APIUserAbortError) throw new TaskError('Task was cancelled', 'aborted', err);
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new TaskError('The API key was rejected. Check it in Settings.', 'auth', err);
      }
      if (err instanceof Anthropic.RateLimitError) throw new TaskError('Rate limited by the model provider. Try again later.', 'backend', err);
      if (err instanceof Anthropic.BadRequestError) throw new TaskError(`The provider rejected the request: ${err.message}`, 'config', err);
      if (err instanceof Anthropic.APIError) throw new TaskError(`Model provider error (${err.status ?? 'network'})`, 'backend', err);
      throw new TaskError(err instanceof Error ? err.message : String(err), 'backend', err);
    }
  }
}
