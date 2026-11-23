import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny stand-in for the Anthropic Messages API (streaming). It lets tests drive the real Claude
 * Agent SDK / Claude Code binary end to end without network access or credentials.
 */
export type ScriptStep =
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'error'; status: number; message: string };

export type Responder = (body: MessagesRequestBody, turn: number) => ScriptStep;

export interface MessagesRequestBody {
  model: string;
  system?: unknown;
  messages: { role: string; content: unknown }[];
  tools?: { name: string }[];
}

export interface FakeAnthropic {
  url: string;
  requests: MessagesRequestBody[];
  close(): Promise<void>;
}

function sse(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

let idCounter = 0;

export async function startFakeAnthropic(responder: Responder): Promise<FakeAnthropic> {
  const requests: MessagesRequestBody[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 100 }));
        return;
      }
      const body = JSON.parse(raw) as MessagesRequestBody;
      requests.push(body);
      const step = responder(body, requests.length);
      if (step.kind === 'error') {
        res.writeHead(step.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: step.message } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const msgId = `msg_fake_${++idCounter}`;
      sse(res, 'message_start', {
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      });
      if (step.kind === 'tool') {
        sse(res, 'content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: `toolu_fake_${++idCounter}`, name: step.name, input: {} },
        });
        sse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) },
        });
      } else {
        sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.text } });
      }
      sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
      sse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: step.kind === 'tool' ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 40 },
      });
      sse(res, 'message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** True when the last user message carries a tool_result (i.e. the model's tool call ran). */
export function lastToolResults(body: MessagesRequestBody): { tool_use_id: string; content: unknown }[] {
  const last = body.messages.at(-1);
  if (!last || last.role !== 'user' || !Array.isArray(last.content)) return [];
  return (last.content as { type: string; tool_use_id: string; content: unknown }[]).filter((b) => b.type === 'tool_result');
}

/** Responder for a single structured answer: call StructuredOutput once, then finish. */
export function structuredAnswer(json: unknown): Responder {
  return (body) => {
    if (lastToolResults(body).length) return { kind: 'text', text: 'Done.' };
    return { kind: 'tool', name: 'StructuredOutput', input: json };
  };
}
