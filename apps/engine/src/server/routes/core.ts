import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, type HealthResponse } from '@jobhunter/shared';
import { getSettings, updateSettings, type SettingsPatch } from '@jobhunter/db';
import type { AppContext } from '../../context.js';
import { HttpError, parse } from '../http.js';

export function registerCoreRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    ok: true,
    version: APP_VERSION,
    mode: ctx.config.mode,
    dbPath: ctx.config.dbPath,
    uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
  }));

  app.get('/api/settings', async () => getSettings(ctx.db));

  app.patch('/api/settings', async (req) => {
    const patch = parse(z.record(z.string(), z.unknown()), req.body) as SettingsPatch;
    try {
      const s = updateSettings(ctx.db, patch);
      ctx.bus.invalidate('settings');
      return s;
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new HttpError(400, 'Invalid settings', err.issues);
      }
      throw err;
    }
  });
}
