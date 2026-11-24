import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from '@jobhunter/db';
import { addNote, getApplication, listApplications, pipelineSummary, STATUSES, updateStatus } from './tools.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export interface PipelineServerOptions {
  /** Allow status changes and notes. Off by default: external clients only read. */
  allowWrites?: boolean;
  version?: string;
}

/**
 * MCP server over the Jobhunter pipeline, for any MCP client (Claude Desktop, Claude Code, …).
 * Status changes go through the same state machine as the app, as the "agent" actor, so a client
 * can never mark something as applied on the user's behalf.
 */
export function createPipelineMcpServer(db: Db, opts: PipelineServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'jobhunter-pipeline', version: opts.version ?? '0.1.0' });
  const status = z.enum(STATUSES);

  server.registerTool(
    'pipeline_summary',
    { title: 'Pipeline summary', description: 'Number of applications per board column and per status.', annotations: { readOnlyHint: true } },
    async () => json(pipelineSummary(db)),
  );

  server.registerTool(
    'list_applications',
    {
      title: 'List applications',
      description: 'Applications (one per job) with company, title, status and match score, most recently changed first. Filter by status and/or a text query on title, company and location.',
      inputSchema: {
        statuses: z.array(status).optional().describe('Only these statuses'),
        query: z.string().optional().describe('Text to search in title, company and location'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => json(listApplications(db, args)),
  );

  server.registerTool(
    'get_application',
    {
      title: 'Get application',
      description: 'One application with the posting (shortened), match reasons and gaps, notes and the full timeline.',
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const a = getApplication(db, id);
      return a ? json(a) : fail(`Application ${id} not found`);
    },
  );

  if (opts.allowWrites) {
    server.registerTool(
      'update_status',
      {
        title: 'Update status',
        description:
          'Move an application to another status. Follows the app\'s rules: for example only the user can mark an application as applied or accept an outcome, so some changes are refused.',
        inputSchema: { id: z.number().int().positive(), status, reason: z.string().max(500).describe('Shown on the timeline') },
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      async ({ id, status: to, reason }) => {
        const r = updateStatus(db, id, to, reason);
        return r.ok ? json(r) : fail(r.error ?? 'Refused');
      },
    );
    server.registerTool(
      'add_note',
      {
        title: 'Add note',
        description: 'Append a note to an application (also added to its timeline).',
        inputSchema: { id: z.number().int().positive(), text: z.string().min(1).max(4000) },
      },
      async ({ id, text }) => {
        const r = addNote(db, id, text);
        return r.ok ? json(r) : fail(r.error ?? 'Failed');
      },
    );
  }
  return server;
}
