import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import { CoverLetterSchema, CV_TEMPLATES, FormAnswerSchema, TailoredCvSchema, EMPTY_PROFILE, type DocumentType } from '@jobhunter/shared';
import {
  applications,
  applyRuns,
  desc,
  documents,
  emails,
  eq,
  getProfile,
  getSettings,
  jobs,
  listEvents,
  matches,
  styleProposals,
} from '@jobhunter/db';
import { htmlToPdf, renderCvHtml } from '@jobhunter/mcp-docs';
import type { AppContext } from '../context.js';
import { HttpError, notFound, parse } from '../server/http.js';
import { registerService } from '../services.js';
import { approvePackage, currentDocuments, decideStyleProposal, generatePackage, isDrafting, renderOptions, saveEdit } from './service.js';

const Id = z.object({ id: z.coerce.number().int().positive() });

registerService({
  name: 'auto-drafting',
  start(ctx) {
    ctx.bus.on<number[]>('applications:shortlisted', (ids) => {
      for (const id of ids) void generatePackage(ctx, id).catch((err: unknown) => ctx.log.error({ err, id }, 'drafting failed'));
    });
  },
});

function docView(d: typeof documents.$inferSelect | undefined) {
  if (!d) return null;
  return {
    id: d.id,
    type: d.type,
    language: d.language,
    template: d.template,
    content: d.content,
    factsUsed: d.factsUsed,
    warnings: d.warnings,
    version: d.version,
    approvedAt: d.approvedAt,
    model: d.model,
    createdAt: d.createdAt,
    pdfUrl: d.pdfPath ? `/api/documents/${d.id}/pdf` : null,
  };
}

export function applicationDetail(ctx: AppContext, id: number) {
  const app = ctx.db.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) return null;
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const match = ctx.db.select().from(matches).where(eq(matches.jobId, job.id)).get() ?? null;
  const docs = currentDocuments(ctx, id);
  return {
    application: app,
    job,
    match,
    drafting: isDrafting(id),
    documents: { cv: docView(docs.cv), cover_letter: docView(docs.cover_letter), form_answers: docView(docs.form_answers) },
    events: listEvents(ctx.db, id),
    emails: ctx.db.select().from(emails).where(eq(emails.applicationId, id)).orderBy(desc(emails.receivedAt)).all(),
    applyRuns: ctx.db.select().from(applyRuns).where(eq(applyRuns.applicationId, id)).orderBy(desc(applyRuns.id)).all(),
  };
}

export function registerDocumentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/applications/:id', async (req) => {
    const { id } = parse(Id, req.params);
    return applicationDetail(ctx, id) ?? notFound();
  });

  app.post('/api/applications/:id/generate', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(
      z.object({ types: z.array(z.enum(['cv', 'cover_letter', 'form_answers'])).optional(), instruction: z.string().max(1000).nullable().optional() }),
      req.body ?? {},
    );
    const a = ctx.db.select().from(applications).where(eq(applications.id, id)).get();
    if (!a) notFound();
    void generatePackage(ctx, id, { types: body.types, instruction: body.instruction ?? null }).catch((err: unknown) => ctx.log.error({ err }, 'generate failed'));
    return { started: true };
  });

  app.put('/api/documents/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const doc = ctx.db.select().from(documents).where(eq(documents.id, id)).get();
    if (!doc) notFound();
    const schemas: Record<DocumentType, z.ZodType> = { cv: TailoredCvSchema, cover_letter: CoverLetterSchema, form_answers: z.array(FormAnswerSchema) };
    const content = parse(schemas[doc.type as DocumentType], (req.body as { content?: unknown } | null)?.content);
    const newId = await saveEdit(ctx, id, content);
    return { id: newId };
  });

  app.post('/api/applications/:id/approve', async (req) => {
    const { id } = parse(Id, req.params);
    const docs = currentDocuments(ctx, id);
    if (!docs.cv || !docs.cover_letter) throw new HttpError(400, 'Generate the CV and cover letter first');
    approvePackage(ctx, id, 'user');
    return { ok: true };
  });

  app.get('/api/documents/:id/pdf', async (req, reply) => {
    const { id } = parse(Id, req.params);
    const doc = ctx.db.select().from(documents).where(eq(documents.id, id)).get();
    if (!doc?.pdfPath || !existsSync(doc.pdfPath)) notFound('No PDF for this document');
    reply.header('content-disposition', `inline; filename="${basename(doc.pdfPath)}"`);
    return reply.type('application/pdf').send(createReadStream(doc.pdfPath));
  });

  app.get('/api/approvals', async () => {
    const rows = ctx.db.select({ app: applications, job: jobs }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.status, 'ready')).all();
    const prepared = ctx.db.select().from(applyRuns).where(eq(applyRuns.status, 'prepared')).all();
    return {
      packages: rows
        .map((r) => {
          const d = currentDocuments(ctx, r.app.id);
          return { applicationId: r.app.id, company: r.job.company, title: r.job.title, approved: !!d.cv?.approvedAt && !!d.cover_letter?.approvedAt, warnings: [...(d.cv?.warnings ?? []), ...(d.cover_letter?.warnings ?? [])], updatedAt: r.app.updatedAt };
        })
        .filter((p) => !p.approved),
      preparedForms: prepared.map((p) => {
        const a = ctx.db.select({ job: jobs }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.id, p.applicationId)).get();
        return { runId: p.id, applicationId: p.applicationId, company: a?.job.company ?? '', title: a?.job.title ?? '', screenshotUrl: p.screenshotPath ? `/api/apply-runs/${p.id}/screenshot` : null, stopReason: p.stopReason, createdAt: p.createdAt };
      }),
    };
  });

  // Style learning proposals
  app.get('/api/style/proposals', async () => ctx.db.select().from(styleProposals).where(eq(styleProposals.status, 'pending')).all());
  app.post('/api/style/proposals/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ accept: z.boolean(), rules: z.array(z.string().max(300)).optional() }), req.body);
    try {
      decideStyleProposal(ctx, id, body.accept, body.rules);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return { ok: true };
  });

  // Template preview with the user's own profile (or a sample)
  app.get('/api/templates/:template/preview.pdf', async (req, reply) => {
    const { template } = parse(z.object({ template: z.enum(CV_TEMPLATES) }), req.params);
    const settings = getSettings(ctx.db);
    const p = getProfile(ctx.db).data;
    const profile = p.basics.name ? p : { ...EMPTY_PROFILE, basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example', label: 'Product Manager', email: 'alex@example.com' } };
    const work = profile.work.length ? profile.work : [{ id: 'w', name: 'Fictional Data AG', position: 'Senior Product Manager', location: 'Zurich', startDate: '2021-03', highlights: ['Led a team of 6 engineers to launch a data product.'] }];
    const cv = {
      summary: profile.basics.summary,
      summaryFactIds: [],
      sections: [
        { kind: 'experience' as const, title: 'Experience', items: work.map((w) => ({ refId: w.id, heading: w.name, subheading: w.position, location: w.location, dates: `${w.startDate ?? ''} – ${w.endDate ?? ''}`, bullets: w.highlights.slice(0, 3).map((h) => ({ text: h, factIds: ['x'] })) })) },
        { kind: 'education' as const, title: 'Education', items: profile.education.map((e) => ({ refId: e.id, heading: e.institution, subheading: [e.studyType, e.area].filter(Boolean).join(' '), dates: `${e.startDate ?? ''} – ${e.endDate ?? ''}`, bullets: [] })) },
        { kind: 'skills' as const, title: 'Skills', items: profile.skills.length ? [{ heading: 'Skills', bullets: profile.skills.map((s) => ({ text: s.name, factIds: ['x'] })) }] : [] },
      ],
      gaps: [],
    };
    const opts = { ...renderOptions(settings, profile, settings.language), template };
    const { pdf } = await htmlToPdf(renderCvHtml(cv, profile, opts), opts.paper);
    return reply.type('application/pdf').send(pdf);
  });
}
