import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProfileSchema } from '@jobhunter/shared';
import {
  addStyleSample,
  allFacts,
  deleteFact,
  deleteStyleSample,
  eq,
  getProfile,
  getStyleProfiles,
  listStyleSamples,
  profileHistory,
  profileImports,
  saveStyleProfile,
  upsertFacts,
  getStyleProfile,
} from '@jobhunter/db';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { HttpError, notFound, parse } from '../server/http.js';
import { UnsupportedFileError } from './extract-text.js';
import {
  analyzeStyle,
  answerInterview,
  applyImport,
  commitProfile,
  confirmInterview,
  currentInterview,
  finishInterview,
  latestImport,
  startImport,
  startInterview,
} from './service.js';

const Id = z.object({ id: z.coerce.number().int().positive() });

export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/profile', async () => {
    const p = getProfile(ctx.db);
    return { profile: p.data, version: p.version, facts: allFacts(ctx.db), history: profileHistory(ctx.db, 20) };
  });

  app.put('/api/profile', async (req) => {
    const data = parse(ProfileSchema, (req.body as { profile?: unknown } | null)?.profile);
    return commitProfile(ctx, data, 'manual');
  });

  // CV / LinkedIn PDF upload → extraction → review
  app.post('/api/profile/imports', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    const kindField = file.fields.kind as { value?: string } | undefined;
    const kind = kindField?.value === 'linkedin_pdf' ? 'linkedin_pdf' : 'cv';
    const data = await file.toBuffer();
    try {
      const id = await startImport(ctx, { filename: file.filename, data }, kind);
      return { id };
    } catch (err) {
      if (err instanceof UnsupportedFileError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  app.get('/api/profile/imports/latest', async () => {
    const imp = latestImport(ctx);
    return imp ? { ...imp, filePath: undefined } : null;
  });

  app.get('/api/profile/imports/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const imp = ctx.db.select().from(profileImports).where(eq(profileImports.id, id)).get();
    if (!imp) notFound();
    return { ...imp, filePath: undefined };
  });

  app.post('/api/profile/imports/:id/apply', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ profile: ProfileSchema }), req.body);
    return applyImport(ctx, id, body.profile);
  });

  app.post('/api/profile/imports/:id/discard', async (req) => {
    const { id } = parse(Id, req.params);
    ctx.db.update(profileImports).set({ status: 'discarded' }).where(eq(profileImports.id, id)).run();
    ctx.bus.invalidate('profile-import');
    return { ok: true };
  });

  // Photo for CV templates that use one (stored locally, embedded into PDFs only when enabled)
  app.post('/api/profile/photo', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    if (!/^image\/(jpeg|png)$/u.test(file.mimetype)) throw new HttpError(400, 'Upload a JPEG or PNG image');
    const data = await file.toBuffer();
    if (data.length > 3 * 1024 * 1024) throw new HttpError(400, 'The photo must be under 3 MB');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(ctx.config.filesDir, { recursive: true });
    const path = join(ctx.config.filesDir, file.mimetype === 'image/png' ? 'photo.png' : 'photo.jpg');
    writeFileSync(path, data);
    const p = getProfile(ctx.db).data;
    commitProfile(ctx, { ...p, basics: { ...p.basics, photoPath: path } }, 'manual');
    return { ok: true };
  });

  // Facts
  app.post('/api/profile/facts', async (req) => {
    const body = parse(z.object({ text: z.string().min(3).max(1000), category: z.string().default('other') }), req.body);
    const id = `fm_${randomUUID().slice(0, 12)}`;
    upsertFacts(ctx.db, [{ id, text: body.text, category: body.category, source: 'manual', confirmed: true }]);
    ctx.bus.invalidate('facts', 'profile');
    return { id };
  });

  app.patch('/api/profile/facts/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ text: z.string().min(3).max(1000) }), req.body);
    const fact = allFacts(ctx.db).find((f) => f.id === id);
    if (!fact) notFound();
    if (fact.source === 'cv') throw new HttpError(400, 'This fact comes from your profile. Edit the profile entry instead.');
    upsertFacts(ctx.db, [{ id, text: body.text, category: fact.category, source: fact.source, refId: fact.refId, confirmed: true }]);
    ctx.bus.invalidate('facts', 'profile');
    return { ok: true };
  });

  app.delete('/api/profile/facts/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    deleteFact(ctx.db, id);
    ctx.bus.invalidate('facts', 'profile');
    return { ok: true };
  });

  // Interview
  app.get('/api/interview', async () => currentInterview(ctx));
  app.post('/api/interview/start', async (req) => {
    const body = parse(z.object({ goals: z.string().max(2000).nullable().default(null) }), req.body ?? {});
    return startInterview(ctx, body.goals);
  });
  app.post('/api/interview/:id/answer', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ answer: z.string().max(5000).nullable() }), req.body);
    return answerInterview(ctx, id, body.answer);
  });
  app.post('/api/interview/:id/finish', async (req) => {
    const { id } = parse(Id, req.params);
    return finishInterview(ctx, id);
  });
  app.post('/api/interview/:id/confirm', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ facts: z.array(z.object({ text: z.string().max(1000), category: z.string() })) }), req.body);
    return confirmInterview(ctx, id, body.facts);
  });

  // Writing style
  app.get('/api/style', async () => ({ profiles: getStyleProfiles(ctx.db), samples: listStyleSamples(ctx.db) }));
  app.post('/api/style/samples', async (req) => {
    const body = parse(z.object({ language: z.string().min(2).max(5), text: z.string().min(40).max(20_000) }), req.body);
    const id = addStyleSample(ctx.db, body.language, body.text, 'pasted');
    ctx.bus.invalidate('style');
    return { id };
  });
  app.delete('/api/style/samples/:id', async (req) => {
    const { id } = parse(Id, req.params);
    deleteStyleSample(ctx.db, id);
    ctx.bus.invalidate('style');
    return { ok: true };
  });
  app.post('/api/style/analyze', async (req) => {
    const body = parse(z.object({ language: z.string().min(2).max(5) }), req.body);
    try {
      return await analyzeStyle(ctx, body.language);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });
  app.patch('/api/style/:language/rules', async (req) => {
    const { language } = parse(z.object({ language: z.string() }), req.params);
    const body = parse(z.object({ rules: z.array(z.string().max(300)).max(50) }), req.body);
    const s = getStyleProfile(ctx.db, language);
    if (!s) notFound();
    saveStyleProfile(ctx.db, { ...s, rules: body.rules });
    ctx.bus.invalidate('style');
    return { ok: true };
  });
}
