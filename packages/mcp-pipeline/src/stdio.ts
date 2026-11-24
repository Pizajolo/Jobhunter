import { existsSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from '@jobhunter/db';
import { createPipelineMcpServer } from './server.js';

/**
 * Serves the pipeline tools over stdio. The engine exposes this as `main.js mcp [--allow-writes]`.
 * It opens the same SQLite file as the running app (WAL mode allows both) and never runs migrations
 * itself, so start Jobhunter once before connecting a client.
 */
export async function runStdioServer(dbPath: string, opts: { allowWrites?: boolean; version?: string } = {}): Promise<void> {
  if (!existsSync(dbPath)) throw new Error(`No Jobhunter database at ${dbPath}. Start Jobhunter once first (or set JOBHUNTER_DATA_DIR).`);
  const handle = openDb(dbPath, { migrate: false });
  const server = createPipelineMcpServer(handle.db, opts);
  await server.connect(new StdioServerTransport());
  const close = () => {
    void server.close();
    handle.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  process.stdin.on('close', close);
}
