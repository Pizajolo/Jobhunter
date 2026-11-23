import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from '@jobhunter/shared';
import { desc, scanRuns, sources } from '@jobhunter/db';
import type { AppContext } from '../../context.js';

export function registerDiagnosticsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/diagnostics', async () => ({
    version: APP_VERSION,
    mode: ctx.config.mode,
    dataDir: ctx.config.dataDir,
    sources: ctx.db.select().from(sources).all(),
    lastScan: ctx.db.select().from(scanRuns).orderBy(desc(scanRuns.id)).limit(1).get() ?? null,
  }));

  // Logs are already redacted when written (see logger.ts).
  app.get('/api/diagnostics/logs', async (_req, reply) => {
    const file = join(ctx.config.dataDir, 'logs', 'engine.log');
    if (!existsSync(file)) return reply.type('text/plain').send('No log file yet.\n');
    const size = statSync(file).size;
    const start = Math.max(0, size - 5 * 1024 * 1024);
    reply.header('content-disposition', 'attachment; filename="jobhunter-engine.log"');
    return reply.type('text/plain').send(createReadStream(file, { start }));
  });
}
