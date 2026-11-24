import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import { getProfile, getSettings } from '@jobhunter/db';
import type { AppContext } from '../context.js';
import { SECRET_KEYS } from '../secrets/index.js';
import { closeBrowserSession } from '../apply/service.js';
import { HttpError, parse } from '../server/http.js';

/** Tables that are not user data: migration bookkeeping and the server-mode login. */
const KEEP_TABLES = new Set(['__drizzle_migrations', 'auth_sessions']);
const STORED = /\.(png|jpe?g|webp|pdf|zip|gz|docx)$/iu;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const README = `Jobhunter data export
=====================

jobhunter.sqlite   The complete database: profile and facts, search profile, companies, jobs,
                   matches, applications with their timeline, documents, email metadata
                   (subject, snippet, sender; no full bodies), chat, model usage and settings.
                   Open it with any SQLite tool, e.g. https://sqlitebrowser.org
files/             Generated CVs and cover letters, uploaded CVs, photo, application screenshots.
profile.json       Your master profile as JSON.
settings.json      Your settings as JSON.

Not included, on purpose:
- API keys, the Gmail token and the IMAP app password (they stay in your keychain or
  encrypted secrets file).
- The application browser profile (it contains your job-portal logins).
- Your Claude login, which belongs to Claude Code, not to Jobhunter.
`;

/** Streams a zip of the database snapshot and all files (spec §2.7: your data, exportable at any time). */
export function exportData(ctx: AppContext): PassThrough {
  const out = new PassThrough();
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      out.destroy(err);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });
  const add = (name: string, data: Uint8Array, compress = true) => {
    const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(entry);
    entry.push(data, true);
  };
  const enc = new TextEncoder();
  try {
    add('README.txt', enc.encode(README));
    // serialize() gives a consistent snapshot, even while the scheduler is writing.
    add('jobhunter.sqlite', new Uint8Array(ctx.dbHandle.sqlite.serialize()));
    add('profile.json', enc.encode(JSON.stringify(getProfile(ctx.db).data, null, 2)));
    add('settings.json', enc.encode(JSON.stringify(getSettings(ctx.db), null, 2)));
    for (const file of walk(ctx.config.filesDir)) {
      const name = `files/${relative(ctx.config.filesDir, file).split(sep).join('/')}`;
      add(name, new Uint8Array(readFileSync(file)), !STORED.test(file));
    }
    zip.end();
  } catch (err) {
    out.destroy(err instanceof Error ? err : new Error(String(err)));
  }
  return out;
}

function clearDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
}

/**
 * Deletes everything Jobhunter stored: all database rows, generated and uploaded files, the
 * application browser profile (portal logins), the agent work folder, logs and all saved secrets.
 * Kept: the database schema and, in server mode, the sign-in password, so the owner can still
 * get in. The Claude login belongs to Claude Code and is not touched.
 */
export async function deleteEverything(ctx: AppContext): Promise<{ tables: number; files: number }> {
  await closeBrowserSession(ctx);
  const sqlite = ctx.dbHandle.sqlite;
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((t) => t.name)
    .filter((n) => !KEEP_TABLES.has(n));
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.transaction(() => {
      for (const t of tables) {
        if (t === 'kv') sqlite.prepare("DELETE FROM kv WHERE key NOT LIKE 'auth:%'").run();
        else sqlite.prepare(`DELETE FROM "${t.replaceAll('"', '""')}"`).run();
      }
    })();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  if (ctx.config.dbPath !== ':memory:') sqlite.exec('VACUUM');
  const files = walk(ctx.config.filesDir).length;
  for (const dir of [ctx.config.filesDir, ctx.config.browserProfileDir, join(ctx.config.dataDir, 'agent-workdir'), join(ctx.config.dataDir, 'logs')]) clearDir(dir);
  for (const key of SECRET_KEYS) await ctx.secrets.delete(key).catch(() => undefined);
  ctx.runtime.emailConnected = false;
  ctx.log.warn({ tables: tables.length, files }, 'all user data deleted on request');
  ctx.bus.invalidate('board', 'summary', 'settings', 'profile', 'companies', 'sources', 'notifications', 'diagnostics');
  return { tables: tables.length, files };
}

export function registerDataRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/data/export', async (_req, reply) => {
    const day = new Date().toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="jobhunter-export-${day}.zip"`);
    reply.header('cache-control', 'no-store');
    return reply.type('application/zip').send(exportData(ctx));
  });

  app.post('/api/data/delete-all', async (req) => {
    const body = parse(z.object({ confirm: z.string() }), req.body);
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
    return deleteEverything(ctx);
  });

  app.get('/api/data/usage', async () => {
    const size = (dir: string) => walk(dir).reduce((s, f) => s + statSync(f).size, 0);
    const dbBytes = ctx.config.dbPath === ':memory:' || !existsSync(ctx.config.dbPath) ? 0 : statSync(ctx.config.dbPath).size;
    return { dataDir: ctx.config.dataDir, dbBytes, fileBytes: size(ctx.config.filesDir), browserProfileBytes: size(ctx.config.browserProfileDir) };
  });
}
