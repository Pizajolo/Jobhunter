import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context.js';
import { HttpError, sendError } from './http.js';
import { scrubSecrets } from '../logger.js';
import { registerAuth } from './auth.js';

export type RouteRegistrar = (app: FastifyInstance, ctx: AppContext) => void | Promise<void>;


export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    // pino's Logger is a FastifyBaseLogger at runtime; the generic only differs in optional typing
    loggerInstance: ctx.log.child({ mod: 'http' }, { level: ctx.log.level === 'silent' ? 'silent' : ctx.config.mode === 'dev' ? 'info' : 'warn' }) as FastifyBaseLogger,
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: ctx.config.mode === 'server',
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 5 } });
  await app.register(websocket);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: scrubSecrets(e.message ?? 'Bad request') });
    }
    req.log.error({ err }, 'request failed');
    return reply.status(500).send({ error: scrubSecrets(e.message ?? 'Internal error') });
  });

  registerAuth(app, ctx);

  // The auth hook (server mode) also guards the WebSocket upgrade request.
  app.get('/api/ws', { websocket: true }, (socket) => {
    const off = ctx.bus.onWs((m) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(m));
    });
    socket.on('close', off);
  });

  const { featureRoutes } = await import('../modules.js');
  for (const r of featureRoutes) await r(app, ctx);

  const webDist = ctx.config.webDistDir;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
