import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkBackend } from '../src/agent/backends/agent-sdk.js';
import { toModelJsonSchema } from '../src/agent/schema.js';
import { startFakeAnthropic, structuredAnswer, lastToolResults, type FakeAnthropic } from './support/fake-anthropic.js';

/**
 * Drives the real Claude Code binary (via the Agent SDK) against a local fake Messages API.
 * Proves the backend wiring (system prompt, structured output, MCP tools, no built-in tools)
 * without network access or any credentials.
 */
const servers: FakeAnthropic[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});

function backend(url: string) {
  const home = mkdtempSync(join(tmpdir(), 'jh-sdk-'));
  return new AgentSdkBackend(join(home, 'work'), async () => ({
    PATH: process.env.PATH ?? '',
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: 'test-token-local-fake',
    DISABLE_TELEMETRY: '1',
    DISABLE_AUTOUPDATER: '1',
  }));
}

describe('AgentSdkBackend (real SDK, fake API)', () => {
  it('returns structured output and disables built-in tools', async () => {
    const fake = await startFakeAnthropic(structuredAnswer({ ok: true, reply: 'hello' }));
    servers.push(fake);
    const schema = toModelJsonSchema(z.object({ ok: z.boolean(), reply: z.string() }));
    const r = await backend(fake.url).run({ task: 'connection_test', model: 'claude-haiku-5-5', system: 'JOBHUNTER SYSTEM', prompt: 'hi', jsonSchema: schema });
    expect(r.json).toEqual({ ok: true, reply: 'hello' });
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    const first = fake.requests[0]!;
    expect(JSON.stringify(first.system)).toContain('JOBHUNTER SYSTEM');
    const toolNames = (first.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('StructuredOutput');
    for (const builtin of ['Bash', 'Write', 'Edit', 'Read', 'WebFetch']) expect(toolNames).not.toContain(builtin);
  }, 60_000);

  it('lets the agent call Jobhunter MCP tools', async () => {
    let called = '';
    const server = createSdkMcpServer({
      name: 'jh',
      tools: [
        tool('lookup', 'Look something up', { q: z.string() }, async ({ q }) => {
          called = q;
          return { content: [{ type: 'text', text: `answer for ${q}` }] };
        }),
      ],
    });
    const fake = await startFakeAnthropic((body, turn) => {
      const results = lastToolResults(body);
      if (turn === 1) return { kind: 'tool', name: 'mcp__jh__lookup', input: { q: 'acme' } };
      if (results.length && JSON.stringify(results).includes('answer for acme')) return { kind: 'tool', name: 'StructuredOutput', input: { found: 'acme' } };
      return { kind: 'text', text: 'Done.' };
    });
    servers.push(fake);
    const r = await backend(fake.url).run({
      task: 'company_discovery',
      model: 'claude-sonnet-5-5',
      system: 'sys',
      prompt: 'go',
      jsonSchema: toModelJsonSchema(z.object({ found: z.string() })),
      mcpServers: { jh: server },
      allowedTools: ['mcp__jh__lookup'],
    });
    expect(called).toBe('acme');
    expect(r.json).toEqual({ found: 'acme' });
  }, 60_000);

  it('reports provider errors as task errors', async () => {
    const fake = await startFakeAnthropic(() => ({ kind: 'error', status: 400, message: 'bad thing' }));
    servers.push(fake);
    await expect(
      backend(fake.url).run({ task: 'connection_test', model: 'claude-haiku-5-5', system: 's', prompt: 'p', jsonSchema: { type: 'object', properties: {}, additionalProperties: false } }),
    ).rejects.toThrow();
  }, 60_000);
});
