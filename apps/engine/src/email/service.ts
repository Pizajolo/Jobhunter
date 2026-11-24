import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addStyleSample,
  and,
  events,
  gt,
  applications,
  desc,
  emails,
  eq,
  getSettings,
  inArray,
  jobs,
  kvDelete,
  kvGet,
  kvSet,
  updateSettings,
  ne,
} from '@jobhunter/db';
import { GmailApiProvider, ImapProvider, gmailAuthUrl, gmailExchangeCode, stripQuoted, type EmailProvider } from '@jobhunter/mcp-email';
import { EmailClassSchema } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { HttpError, notFound, parse } from '../server/http.js';
import { registerJob } from '../scheduler.js';
import { scrubSecrets } from '../logger.js';
import { notify } from '../notify.js';
import { applyNoResponseRule, linkAndUpdate, processEmails } from './pipeline.js';
import { detectLanguage } from '../documents/service.js';

const CURSOR_KEY = 'email:cursor';
const providerOverrides = new WeakMap<AppContext, EmailProvider>();

/** Tests inject a fake provider. */
export function setEmailProviderOverride(ctx: AppContext, p: EmailProvider | null): void {
  if (p) providerOverrides.set(ctx, p);
  else providerOverrides.delete(ctx);
}

export async function createProvider(ctx: AppContext): Promise<EmailProvider | null> {
  const forced = providerOverrides.get(ctx);
  if (forced) return forced;
  const s = getSettings(ctx.db).email;
  if (s.provider === 'gmail_api') {
    const [secret, refresh] = await Promise.all([ctx.secrets.get('gmail_oauth_client_secret'), ctx.secrets.get('gmail_refresh_token')]);
    if (!s.gmailClientId || !secret || !refresh) return null;
    return new GmailApiProvider({ clientId: s.gmailClientId, clientSecret: secret }, refresh);
  }
  if (s.provider === 'imap') {
    const pw = await ctx.secrets.get('imap_app_password');
    if (!s.address || !pw) return null;
    return new ImapProvider({ host: s.imapHost, port: s.imapPort, secure: s.imapPort === 993, user: s.address, password: pw });
  }
  return null;
}

let syncing = false;

export async function syncEmail(ctx: AppContext): Promise<{ processed: number; changed: number; review: number } | null> {
  if (syncing) return null;
  syncing = true;
  const provider = await createProvider(ctx);
  try {
    if (!provider) return null;
    const cursor = kvGet(ctx.db, CURSOR_KEY);
    const res = await provider.sync(cursor, { initialDays: 30, max: 300 });
    const out = await processEmails(ctx, res.messages, provider, provider.kind);
    kvSet(ctx.db, CURSOR_KEY, res.cursor);
    kvSet(ctx.db, 'email:lastSyncAt', new Date().toISOString());
    kvDelete(ctx.db, 'email:lastError');
    ctx.runtime.emailConnected = true;
    return { processed: out.filter((o) => o.action !== 'filtered').length, changed: out.filter((o) => o.action === 'status_changed').length, review: out.filter((o) => o.action === 'review').length };
  } catch (err) {
    const msg = scrubSecrets((err as Error).message);
    kvSet(ctx.db, 'email:lastError', msg);
    ctx.runtime.emailConnected = false;
    ctx.log.warn({ err: msg }, 'email sync failed');
    throw err;
  } finally {
    syncing = false;
    await provider?.close().catch(() => undefined);
    ctx.bus.invalidate('email-status', 'summary');
  }
}

registerJob({
  name: 'email-sync',
  schedule: (ctx) => {
    const s = getSettings(ctx.db).email;
    return s.provider === 'none' ? { kind: 'off' } : { kind: 'every', minutes: s.syncIntervalMinutes };
  },
  run: (ctx) => syncEmail(ctx),
});
registerJob({ name: 'no-response', schedule: () => ({ kind: 'daily', time: '03:30' }), run: async (ctx) => applyNoResponseRule(ctx) });

// ---------- OAuth state ----------
const pending = new Map<string, { codeVerifier: string; redirectUri: string; at: number }>();

function redirectUri(ctx: AppContext, req: { protocol: string; headers: { host?: string } }): string {
  if (process.env.JOBHUNTER_PUBLIC_URL) return `${process.env.JOBHUNTER_PUBLIC_URL.replace(/\/$/u, '')}/api/email/gmail/callback`;
  // Google "Desktop app" clients accept any loopback port.
  const host = req.headers.host ?? `127.0.0.1:${ctx.config.port}`;
  const port = host.split(':')[1] ?? String(ctx.config.port);
  return `http://127.0.0.1:${port}/api/email/gmail/callback`;
}

export function registerEmailRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/email/status', async () => {
    const s = getSettings(ctx.db).email;
    return {
      provider: s.provider,
      address: s.address,
      connected: ctx.runtime.emailConnected || (s.provider !== 'none' && !!kvGet(ctx.db, 'email:lastSyncAt') && !kvGet(ctx.db, 'email:lastError')),
      lastSyncAt: kvGet(ctx.db, 'email:lastSyncAt'),
      lastError: kvGet(ctx.db, 'email:lastError'),
      gmailClientId: s.gmailClientId,
    };
  });

  app.post('/api/email/sync', async () => {
    try {
      return (await syncEmail(ctx)) ?? { processed: 0, changed: 0, review: 0, skipped: true };
    } catch (err) {
      throw new HttpError(502, `Email sync failed: ${scrubSecrets((err as Error).message)}`);
    }
  });

  // Gmail API with the user's own Google Cloud OAuth client (docs/GMAIL_OAUTH.md)
  app.post('/api/email/gmail/start', async (req) => {
    const body = parse(z.object({ clientId: z.string().min(10), clientSecret: z.string().min(5).optional() }), req.body);
    if (body.clientSecret) await ctx.secrets.set('gmail_oauth_client_secret', body.clientSecret);
    const secret = await ctx.secrets.get('gmail_oauth_client_secret');
    if (!secret) throw new HttpError(400, 'Client secret required');
    updateSettings(ctx.db, { email: { gmailClientId: body.clientId } });
    const state = randomBytes(16).toString('hex');
    const uri = redirectUri(ctx, req);
    const { url, codeVerifier } = await gmailAuthUrl({ clientId: body.clientId, clientSecret: secret, redirectUri: uri }, state);
    pending.set(state, { codeVerifier, redirectUri: uri, at: Date.now() });
    return { url };
  });

  app.get('/api/email/gmail/callback', async (req, reply) => {
    const q = parse(z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }), req.query);
    const p = pending.get(q.state);
    pending.delete(q.state);
    const page = (msg: string) =>
      reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>Jobhunter</title><body style="font-family:system-ui;padding:40px"><h1>Jobhunter</h1><p>${msg}</p><p><a href="/settings">Back to Jobhunter</a></p></body>`);
    if (!p || Date.now() - p.at > 15 * 60_000) return page('This sign-in link expired. Start again from Settings → Email.');
    if (q.error || !q.code) return page(`Google sign-in was cancelled (${q.error ?? 'no code'}).`);
    const s = getSettings(ctx.db).email;
    const secret = await ctx.secrets.get('gmail_oauth_client_secret');
    try {
      const { refreshToken } = await gmailExchangeCode({ clientId: s.gmailClientId!, clientSecret: secret!, redirectUri: p.redirectUri }, q.code, p.codeVerifier);
      await ctx.secrets.set('gmail_refresh_token', refreshToken);
      const provider = await createProvider(ctx);
      const address = provider ? await provider.verify() : null;
      updateSettings(ctx.db, { email: { provider: 'gmail_api', address } });
      ctx.runtime.emailConnected = true;
      kvDelete(ctx.db, CURSOR_KEY);
      ctx.bus.invalidate('email-status', 'settings', 'summary');
      void syncEmail(ctx).catch(() => undefined);
      return page(`Connected ${address ?? 'your Gmail account'}. You can close this tab.`);
    } catch (err) {
      return page(`Could not connect: ${scrubSecrets((err as Error).message)}`);
    }
  });

  app.post('/api/email/imap', async (req) => {
    const body = parse(
      z.object({ address: z.string().email(), appPassword: z.string().min(8).max(64), host: z.string().default('imap.gmail.com'), port: z.number().int().default(993) }),
      req.body,
    );
    const provider = new ImapProvider({ host: body.host, port: body.port, secure: body.port === 993, user: body.address, password: body.appPassword.replace(/\s+/gu, '') });
    try {
      await provider.verify();
    } catch (err) {
      throw new HttpError(400, `Could not log in: ${scrubSecrets((err as Error).message)}. Check the address and app password.`);
    } finally {
      await provider.close();
    }
    await ctx.secrets.set('imap_app_password', body.appPassword.replace(/\s+/gu, ''));
    updateSettings(ctx.db, { email: { provider: 'imap', address: body.address, imapHost: body.host, imapPort: body.port } });
    kvDelete(ctx.db, CURSOR_KEY);
    ctx.runtime.emailConnected = true;
    ctx.bus.invalidate('email-status', 'settings', 'summary');
    void syncEmail(ctx).catch(() => undefined);
    return { ok: true };
  });

  app.post('/api/email/disconnect', async () => {
    await ctx.secrets.delete('gmail_refresh_token');
    await ctx.secrets.delete('imap_app_password');
    updateSettings(ctx.db, { email: { provider: 'none', address: null } });
    kvDelete(ctx.db, CURSOR_KEY);
    ctx.runtime.emailConnected = false;
    ctx.bus.invalidate('email-status', 'settings', 'summary');
    return { ok: true };
  });

  // Opt-in: sample sent mail as writing-style examples (spec §5.1 step 5)
  app.post('/api/email/sample-sent', async () => {
    if (!getSettings(ctx.db).email.sampleSentForStyle) throw new HttpError(400, 'Enable "use sent emails for my writing style" first');
    const provider = await createProvider(ctx);
    if (!provider) throw new HttpError(400, 'Connect your inbox first');
    try {
      const sent = await provider.listSent(30);
      let added = 0;
      for (const m of sent) {
        const text = stripQuoted(m.text);
        if (text.length < 200 || text.length > 6000) continue;
        addStyleSample(ctx.db, detectLanguage(text) ?? getSettings(ctx.db).language, text, 'sent_email');
        added++;
        if (added >= 10) break;
      }
      ctx.bus.invalidate('style');
      return { added };
    } finally {
      await provider.close();
    }
  });

  // Inbox: job-related emails only, grouped by application (spec §5.7.5)
  app.get('/api/inbox', async () => {
    const rows = ctx.db
      .select({ email: emails, company: jobs.company, title: jobs.title, status: applications.status })
      .from(emails)
      .leftJoin(applications, eq(applications.id, emails.applicationId))
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .where(ne(emails.classification, 'other'))
      .orderBy(desc(emails.receivedAt))
      .limit(500)
      .all();
    return rows.map((r) => ({ ...r.email, applicationCompany: r.company, applicationTitle: r.title, applicationStatus: r.status }));
  });

  // Review queue (spec §5.7.4)
  app.get('/api/review', async () => {
    const list = ctx.db.select().from(emails).where(eq(emails.reviewStatus, 'pending')).orderBy(desc(emails.receivedAt)).all();
    const appIds = [...new Set(list.map((e) => e.applicationId).filter((x): x is number => x !== null))];
    const suggested = appIds.length
      ? ctx.db.select({ id: applications.id, company: jobs.company, title: jobs.title }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(inArray(applications.id, appIds)).all()
      : [];
    const options = ctx.db
      .select({ id: applications.id, company: jobs.company, title: jobs.title, status: applications.status })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(ne(applications.status, 'found'))
      .all();
    return { emails: list.map((e) => ({ ...e, suggestion: suggested.find((s) => s.id === e.applicationId) ?? null })), applications: options };
  });

  app.post('/api/review/:id', async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const body = parse(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('assign'), applicationId: z.number().int(), classification: EmailClassSchema }),
        z.object({ action: z.literal('ignore') }),
      ]),
      req.body,
    );
    const e = ctx.db.select().from(emails).where(eq(emails.id, id)).get();
    if (!e) notFound();
    if (body.action === 'ignore') {
      ctx.db.update(emails).set({ reviewStatus: 'ignored' }).where(eq(emails.id, id)).run();
    } else {
      ctx.db.update(emails).set({ classification: body.classification }).where(eq(emails.id, id)).run();
      linkAndUpdate(ctx, id, body.applicationId, body.classification, 'user', 1, e);
    }
    ctx.bus.invalidate('review', 'inbox', 'summary', 'board');
    return { ok: true };
  });
}

/** Daily digest (spec §5.8): rejections and "no response" changes in one notification. */
export function sendDailyDigest(ctx: AppContext, now = new Date()): number {
  const since = kvGet(ctx.db, 'digest:lastAt') ?? new Date(now.getTime() - 86_400_000).toISOString();
  const rows = ctx.db
    .select({ e: events, company: jobs.company, title: jobs.title })
    .from(events)
    .innerJoin(applications, eq(applications.id, events.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(events.type, 'status_changed'), gt(events.createdAt, since)))
    .all()
    .filter((r) => ['rejected', 'no_response'].includes(String((r.e.details as { to?: string } | null)?.to)));
  kvSet(ctx.db, 'digest:lastAt', now.toISOString());
  if (!rows.length || !getSettings(ctx.db).notifications.rejectionsInDigest) return 0;
  const rejected = rows.filter((r) => (r.e.details as { to?: string }).to === 'rejected');
  const silent = rows.length - rejected.length;
  notify(ctx, {
    kind: 'digest',
    title: 'Daily summary',
    body: [rejected.length ? `Rejections: ${rejected.map((r) => `${r.company} (${r.title})`).join(', ')}` : '', silent ? `${silent} application(s) marked "no response"` : '']
      .filter(Boolean)
      .join('. '),
    link: '/',
  });
  return rows.length;
}

registerJob({ name: 'daily-digest', schedule: () => ({ kind: 'daily', time: '18:00' }), run: async (ctx) => sendDailyDigest(ctx) });
