import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { and, authSessions, eq, gt, kvDelete, kvGet, kvSet, lt } from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { HttpError, parse } from './http.js';

const SESSION_COOKIE = 'jh_session';
const CSRF_COOKIE = 'jh_csrf';
const SESSION_DAYS = 30;
const PASSWORD_KEY = 'auth:passwordHash';
const SETUP_KEY = 'auth:setupCode';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Paths reachable without a session in server mode. */
const PUBLIC = [/^\/api\/health$/u, /^\/api\/auth\//u, /^\/api\/email\/gmail\/callback/u];

const attempts = new Map<string, { n: number; first: number }>();
const WINDOW = 15 * 60_000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > WINDOW) {
    attempts.set(ip, { n: 1, first: now });
    return false;
  }
  a.n++;
  return a.n > MAX_ATTEMPTS;
}

export function resetLoginAttempts(): void {
  attempts.clear();
}

/** One-time code printed in the server log, needed to set the first password (so nobody else can claim the server). */
export function setupCode(ctx: AppContext): string | null {
  if (kvGet(ctx.db, PASSWORD_KEY)) return null;
  let code = kvGet(ctx.db, SETUP_KEY);
  if (!code) {
    code = process.env.JOBHUNTER_SETUP_CODE ?? randomBytes(4).toString('hex');
    kvSet(ctx.db, SETUP_KEY, code);
  }
  return code;
}

function sessionValid(ctx: AppContext, token: string | undefined): boolean {
  if (!token) return false;
  const row = ctx.db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.tokenHash, sha(token)), gt(authSessions.expiresAt, new Date().toISOString())))
    .get();
  return !!row;
}

function startSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply): void {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  ctx.db.delete(authSessions).where(lt(authSessions.expiresAt, new Date().toISOString())).run();
  ctx.db.insert(authSessions).values({ tokenHash: sha(token), expiresAt: expires.toISOString() }).run();
  // Behind a TLS reverse proxy the request reaches us as plain http, so also trust the configured public URL.
  const secure = req.protocol === 'https' || (process.env.JOBHUNTER_PUBLIC_URL ?? '').startsWith('https://');
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', expires });
  reply.setCookie(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'strict', secure, path: '/', expires });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function csrfValid(req: FastifyRequest): boolean {
  const header = req.headers['x-csrf-token'];
  const cookie = req.cookies[CSRF_COOKIE];
  return typeof header === 'string' && !!cookie && safeEqual(header, cookie);
}

/** `JOBHUNTER_RESET_PASSWORD=1` on start: forget the password and all sessions, print a new setup code. Data is kept. */
export function resetPasswordIfAsked(ctx: AppContext): void {
  if (process.env.JOBHUNTER_RESET_PASSWORD !== '1') return;
  kvDelete(ctx.db, PASSWORD_KEY);
  kvDelete(ctx.db, SETUP_KEY);
  ctx.db.delete(authSessions).run();
  ctx.log.warn('Password reset requested: the old password and all sessions were removed. Remove JOBHUNTER_RESET_PASSWORD again.');
}

/**
 * Server mode (spec §2.7): single-user password (argon2id) with an HttpOnly session cookie and a
 * double-submit CSRF token on every state-changing request.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  if (ctx.config.requireLogin) {
    resetPasswordIfAsked(ctx);
    const code = setupCode(ctx);
    if (code) ctx.log.warn(`No password set yet. Open Jobhunter and use the setup code ${code} to choose one.`);
    app.addHook('onRequest', async (req, reply) => {
      const path = req.url.split('?')[0]!;
      if (!path.startsWith('/api/') || PUBLIC.some((re) => re.test(path))) return;
      if (!sessionValid(ctx, req.cookies[SESSION_COOKIE])) return reply.status(401).send({ error: 'Login required' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !csrfValid(req)) return reply.status(403).send({ error: 'Invalid CSRF token' });
      return undefined;
    });
  }

  app.get('/api/auth/status', async (req) => ({
    required: ctx.config.requireLogin,
    setupNeeded: ctx.config.requireLogin && !kvGet(ctx.db, PASSWORD_KEY),
    loggedIn: !ctx.config.requireLogin || sessionValid(ctx, req.cookies[SESSION_COOKIE]),
  }));

  app.post('/api/auth/setup', async (req, reply) => {
    if (!ctx.config.requireLogin) throw new HttpError(400, 'Login is not used in this mode');
    if (kvGet(ctx.db, PASSWORD_KEY)) throw new HttpError(409, 'A password is already set');
    if (rateLimited(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const body = parse(z.object({ setupCode: z.string(), password: z.string().min(12).max(200) }), req.body);
    const code = setupCode(ctx)!;
    if (!safeEqual(body.setupCode.trim(), code)) throw new HttpError(403, 'Wrong setup code (see the server log)');
    kvSet(ctx.db, PASSWORD_KEY, await hash(body.password));
    startSession(ctx, req, reply);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (rateLimited(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const { password } = parse(z.object({ password: z.string().max(200) }), req.body);
    const stored = kvGet(ctx.db, PASSWORD_KEY);
    if (!stored || !(await verify(stored, password))) throw new HttpError(401, 'Wrong password');
    startSession(ctx, req, reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) ctx.db.delete(authSessions).where(eq(authSessions.tokenHash, sha(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    if (!sessionValid(ctx, req.cookies[SESSION_COOKIE])) throw new HttpError(401, 'Login required');
    if (!csrfValid(req)) throw new HttpError(403, 'Invalid CSRF token');
    if (rateLimited(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const body = parse(z.object({ current: z.string(), password: z.string().min(12).max(200) }), req.body);
    const stored = kvGet(ctx.db, PASSWORD_KEY);
    if (!stored || !(await verify(stored, body.current))) throw new HttpError(401, 'Wrong current password');
    kvSet(ctx.db, PASSWORD_KEY, await hash(body.password));
    ctx.db.delete(authSessions).run();
    return { ok: true };
  });
}
