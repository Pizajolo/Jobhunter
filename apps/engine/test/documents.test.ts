import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applications, documents, jobs, saveProfile, styleEdits, styleProposals, upsertFacts, listEvents } from '@jobhunter/db';
import { EMPTY_PROFILE, type TailoredCv } from '@jobhunter/shared';
import { closeRenderer } from '@jobhunter/mcp-docs';
import type { Cassette } from '../src/agent/cassette.js';
import { anchorToProfile, detectLanguage, generatePackage, resolveLanguage } from '../src/documents/service.js';
import { fixtureJson, testApp } from './support/helpers.js';
import { DEFAULT_SETTINGS } from '@jobhunter/shared';

afterAll(() => closeRenderer());

const cvCas = fixtureJson<Cassette>('llm/cv_tailor/lumen.json');
const letterCas = fixtureJson<Cassette>('llm/cover_letter/lumen.json');
const answersCas = fixtureJson<Cassette>('llm/form_answers/lumen.json');
const rulesCas = fixtureJson<Cassette>('llm/style_rules/passionate.json');

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'jh-docs-'));
  const t = await testApp({ dataDir: dir, filesDir: join(dir, 'files') });
  const { ctx } = t;
  saveProfile(
    ctx.db,
    {
      ...EMPTY_PROFILE,
      basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example', email: 'alex@example.com' },
      work: [
        { id: 'w1', name: 'Fictional Data AG', position: 'Senior Product Manager', location: 'Zurich', startDate: '2021-03', highlights: [] },
        { id: 'w2', name: 'Sample Analytics GmbH', position: 'Product Manager', location: 'Berlin', startDate: '2017-01', endDate: '2021-02', highlights: [] },
      ],
      education: [{ id: 'e1', institution: 'Example Technical University', studyType: 'MSc', area: 'Computer Science', startDate: '2014', endDate: '2016', courses: [], highlights: [] }],
    },
    'manual',
  );
  const facts = (cvCas.input as { facts: { id: string; text: string; category: string }[] }).facts;
  upsertFacts(ctx.db, facts.map((f) => ({ ...f, source: 'manual' as const, confirmed: true })));
  const job = ctx.db
    .insert(jobs)
    .values({ company: 'Lumen Robotics', normCompany: 'lumen robotics', title: 'Senior Product Manager, AI Platform', normTitle: 'x', location: 'Zurich', description: (cvCas.input as { job: { description: string } }).job.description, url: 'https://x.example/1', canonicalUrl: 'https://x.example/1', atsType: 'greenhouse', contentHash: 'h', language: 'en' })
    .returning()
    .get();
  const app = ctx.db.insert(applications).values({ jobId: job.id, status: 'shortlisted' }).returning().get();
  t.fake.on('cv_tailor', () => cvCas.output).on('cover_letter', () => letterCas.output).on('form_answers', () => answersCas.output).on('style_rules', () => rulesCas.output);
  return { ...t, appId: app.id };
}

describe('application package', () => {
  it('drafts CV, letter and answers, renders PDFs and moves the card to ready', async () => {
    const { ctx, app, appId } = await setup();
    await generatePackage(ctx, appId);
    expect(ctx.db.select().from(applications).get()!.status).toBe('ready');
    const detail = (await app.inject({ method: 'GET', url: `/api/applications/${appId}` })).json();
    expect(detail.documents.cv.pdfUrl).toMatch(/\/pdf$/u);
    expect(detail.documents.cv.factsUsed).toContain('f_h1');
    expect(detail.documents.form_answers.warnings.join()).toMatch(/salary/u);
    const docs = ctx.db.select().from(documents).all();
    expect(docs).toHaveLength(3);
    for (const d of docs.filter((x) => x.type !== 'form_answers')) expect(existsSync(d.pdfPath!)).toBe(true);
    const pdf = await app.inject({ method: 'GET', url: detail.documents.cv.pdfUrl });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(Number(pdf.headers['content-length'] ?? pdf.rawPayload.length)).toBeLessThan(1024 * 1024);
    // approval
    const approvals = (await app.inject({ method: 'GET', url: '/api/approvals' })).json();
    expect(approvals.packages).toHaveLength(1);
    await app.inject({ method: 'POST', url: `/api/applications/${appId}/approve` });
    expect((await app.inject({ method: 'GET', url: '/api/approvals' })).json().packages).toHaveLength(0);
  }, 60_000);

  it('rejects invented facts and returns the card to shortlisted', async () => {
    const { ctx, fake, appId } = await setup();
    const bad = structuredClone(cvCas.output) as TailoredCv;
    bad.sections[0]!.items[0]!.bullets.push({ text: 'Managed a budget of CHF 50M', factIds: ['f_h2'] });
    fake.on('cv_tailor', () => bad);
    await generatePackage(ctx, appId, { types: ['cv'] });
    expect(ctx.db.select().from(applications).get()!.status).toBe('shortlisted');
    expect(listEvents(ctx.db, appId).some((e) => e.type === 'draft_failed' && /50/u.test(e.message))).toBe(true);
  }, 60_000);

  it('learns style rules after three edits', async () => {
    const { ctx, app, appId } = await setup();
    await generatePackage(ctx, appId, { types: ['cover_letter'] });
    for (let n = 0; n < 3; n++) {
      const doc = ctx.db.select().from(documents).all().at(-1)!;
      const content = structuredClone(doc.content) as { paragraphs: { text: string }[] };
      content.paragraphs[0]!.text = `Edited opening number ${n}.`;
      const res = await app.inject({ method: 'PUT', url: `/api/documents/${doc.id}`, payload: { content } });
      expect(res.statusCode).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.db.select().from(styleEdits).all()).toHaveLength(3);
    const proposals = ctx.db.select().from(styleProposals).all();
    expect(proposals).toHaveLength(1);
    await app.inject({ method: 'POST', url: `/api/style/proposals/${proposals[0]!.id}`, payload: { accept: true } });
    const style = (await app.inject({ method: 'GET', url: '/api/style' })).json();
    expect(style.profiles[0].rules.join()).toMatch(/passionate/u);
  }, 60_000);

  it('anchors employers, titles and dates to the profile', () => {
    const cv = structuredClone(cvCas.output) as TailoredCv;
    cv.sections[0]!.items[0]!.heading = 'Google';
    cv.sections[0]!.items[0]!.dates = '2010 – 2024';
    const anchored = anchorToProfile(cv, { ...EMPTY_PROFILE, work: [{ id: 'w1', name: 'Fictional Data AG', position: 'Senior Product Manager', startDate: '2021-03', highlights: [] }] }, 'de');
    expect(anchored.sections[0]!.items[0]!.heading).toBe('Fictional Data AG');
    expect(anchored.sections[0]!.items[0]!.dates).toBe('03/2021 – heute');
  });

  it('picks the application language', () => {
    expect(detectLanguage('Wir suchen eine erfahrene Person für unser Team. Sie haben Erfahrung mit Produkten und die Fähigkeit, mit der Entwicklung und dem Vertrieb zu arbeiten, für die wir das Produkt bauen.')).toBe('de');
    const s = DEFAULT_SETTINGS;
    expect(resolveLanguage(s, { language: 'fr', description: '' })).toBe('fr');
    expect(resolveLanguage({ ...s, applicationLanguage: 'fixed:pt' }, { language: 'fr', description: '' })).toBe('pt');
    expect(resolveLanguage({ ...s, applicationLanguage: 'ui', language: 'es' }, { language: 'fr', description: '' })).toBe('es');
  });
});

