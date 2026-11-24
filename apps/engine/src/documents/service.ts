import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addEvent,
  and,
  applications,
  confirmedFacts,
  desc,
  documents,
  eq,
  getProfile,
  getSettings,
  getStyleProfile,
  isNull,
  jobs,
  setApplicationStatus,
  styleEdits,
  styleProposals,
  saveStyleProfile,
} from '@jobhunter/db';
import {
  CONVENTIONS,
  htmlToPdf,
  labels,
  renderCvHtml,
  renderLetterHtml,
} from '@jobhunter/mcp-docs';
import type { CoverLetter, DocumentType, FormAnswer, Profile, ProfileFact, Settings, TailoredCv } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { notify } from '../notify.js';
import { runTask } from '../agent/runner.js';
import { styleProfileText } from '../profile/service.js';
import { coverLetterTask, cvTailorTask, formAnswersTask, styleRulesTask } from '../tasks/documents.js';

// ---------- Language ----------

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'you', 'with', 'our', 'for', 'will', 'are', 'your', 'experience'],
  de: ['und', 'die', 'der', 'mit', 'für', 'wir', 'sie', 'das', 'eine', 'erfahrung'],
  fr: ['et', 'les', 'des', 'vous', 'pour', 'avec', 'nous', 'une', 'dans', 'expérience'],
  es: ['y', 'los', 'las', 'con', 'para', 'una', 'del', 'que', 'nuestro', 'experiencia'],
  pt: ['e', 'os', 'com', 'para', 'uma', 'você', 'não', 'nossa', 'que', 'experiência'],
  it: ['e', 'il', 'con', 'per', 'una', 'che', 'della', 'siamo', 'nostro', 'esperienza'],
};

export function detectLanguage(text: string): string | null {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).slice(0, 3000);
  if (words.length < 20) return null;
  const counts = Object.fromEntries(Object.keys(STOPWORDS).map((l) => [l, 0])) as Record<string, number>;
  const sets = Object.fromEntries(Object.entries(STOPWORDS).map(([l, w]) => [l, new Set(w)]));
  for (const w of words) for (const [l, set] of Object.entries(sets)) if (set.has(w)) counts[l]!++;
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return n >= 5 ? best : null;
}

/** Application language (spec §8 application_language: posting | ui | fixed:<code>). */
export function resolveLanguage(settings: Settings, job: { language: string | null; description: string }): string {
  const pref = settings.applicationLanguage;
  if (pref.startsWith('fixed:')) return pref.slice(6);
  if (pref === 'ui') return settings.language;
  return job.language?.slice(0, 2) ?? detectLanguage(job.description) ?? settings.language;
}

// ---------- Helpers ----------

type JobRow = typeof jobs.$inferSelect;

function factInputs(facts: ProfileFact[]) {
  return facts.map((f) => ({ id: f.id, text: f.text, category: f.category ?? null }));
}

function profileEntries(p: Profile) {
  return [
    ...p.work.map((w) => ({ refId: w.id, kind: 'work' as const, label: `${w.position} at ${w.name} (${w.startDate ?? '?'} – ${w.endDate ?? 'present'})` })),
    ...p.education.map((e) => ({ refId: e.id, kind: 'education' as const, label: `${[e.studyType, e.area].filter(Boolean).join(' ')} at ${e.institution} (${e.startDate ?? '?'} – ${e.endDate ?? ''})` })),
    ...p.projects.map((x) => ({ refId: x.id, kind: 'project' as const, label: x.name })),
    ...p.certificates.map((c) => ({ refId: c.id, kind: 'certificate' as const, label: c.name })),
  ];
}

function formatPeriod(start: string | undefined, end: string | undefined, language: string): string {
  const fmt = (d: string | undefined) => {
    if (!d) return '';
    const m = /^(\d{4})-(\d{2})/u.exec(d);
    return m ? `${m[2]}/${m[1]}` : d;
  };
  const L = labels(language);
  if (!start && !end) return '';
  return `${fmt(start)} – ${end ? fmt(end) : L.present}`;
}

/**
 * Overwrite employer, title, location and dates of experience/education items with the profile's own
 * data, so the model can never change them (spec §2.4).
 */
export function anchorToProfile(cv: TailoredCv, p: Profile, language: string): TailoredCv {
  return {
    ...cv,
    sections: cv.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => {
        const w = p.work.find((x) => x.id === it.refId);
        if (w) return { ...it, heading: w.name, subheading: w.position, location: w.location, dates: formatPeriod(w.startDate, w.endDate, language) };
        const e = p.education.find((x) => x.id === it.refId);
        if (e) return { ...it, heading: e.institution, subheading: [e.studyType, e.area].filter(Boolean).join(' '), location: e.location, dates: formatPeriod(e.startDate, e.endDate, language) };
        return it;
      }),
    })),
  };
}

export function commonQuestions(language: string, job: { company: string }): string[] {
  const q: Record<string, string[]> = {
    en: [`Why do you want to work at ${job.company}?`, 'What are your salary expectations?', 'What is your notice period / earliest start date?', 'Are you authorized to work in this country?'],
    de: [`Warum möchten Sie bei ${job.company} arbeiten?`, 'Wie hoch ist Ihre Gehaltsvorstellung?', 'Wie lang ist Ihre Kündigungsfrist / ab wann sind Sie verfügbar?', 'Haben Sie eine Arbeitsbewilligung für dieses Land?'],
    fr: [`Pourquoi souhaitez-vous travailler chez ${job.company} ?`, 'Quelles sont vos prétentions salariales ?', 'Quel est votre préavis / date de disponibilité ?', 'Êtes-vous autorisé(e) à travailler dans ce pays ?'],
    es: [`¿Por qué quieres trabajar en ${job.company}?`, '¿Cuáles son tus expectativas salariales?', '¿Cuál es tu preaviso / fecha de incorporación?', '¿Tienes permiso de trabajo en este país?'],
    pt: [`Porque queres trabalhar na ${job.company}?`, 'Qual é a tua expectativa salarial?', 'Qual é o teu pré-aviso / data de início?', 'Tens autorização para trabalhar neste país?'],
    it: [`Perché vuoi lavorare in ${job.company}?`, 'Quali sono le tue aspettative salariali?', 'Qual è il tuo preavviso / data di inizio?', 'Sei autorizzato a lavorare in questo paese?'],
  };
  return q[language] ?? q.en!;
}

function docsDir(ctx: AppContext, appId: number): string {
  const d = join(ctx.config.filesDir, 'applications', String(appId));
  mkdirSync(d, { recursive: true });
  return d;
}

function photoDataUrl(p: Profile): string | null {
  if (!p.basics.photoPath || !existsSync(p.basics.photoPath)) return null;
  const ext = p.basics.photoPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  return `data:image/${ext};base64,${readFileSync(p.basics.photoPath).toString('base64')}`;
}

export function renderOptions(settings: Settings, profile: Profile, language: string) {
  const conv = CONVENTIONS[settings.cv.country];
  return {
    template: settings.cv.template,
    language,
    paper: settings.cv.paper,
    photoDataUrl: settings.cv.photo && conv.photo !== 'avoid' ? photoDataUrl(profile) : null,
    personalDetails: conv.personalDetails,
    onePage: settings.cv.pages === 1 || settings.cv.template === 'harvard',
  };
}

/** Render a document's current content to HTML + PDF on disk. */
export async function renderDocument(ctx: AppContext, docId: number): Promise<void> {
  const doc = ctx.db.select().from(documents).where(eq(documents.id, docId)).get();
  if (!doc || doc.type === 'form_answers') return;
  const app = ctx.db.select().from(applications).where(eq(applications.id, doc.applicationId)).get()!;
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const settings = getSettings(ctx.db);
  const profile = getProfile(ctx.db).data;
  const opts = renderOptions(settings, profile, doc.language);
  const html =
    doc.type === 'cv'
      ? renderCvHtml(doc.content as TailoredCv, profile, opts)
      : renderLetterHtml(doc.content as CoverLetter, profile, job, { ...opts, date: new Date() });
  const { pdf, bytes } = await htmlToPdf(html, opts.paper);
  const base = `${doc.type === 'cv' ? 'CV' : 'Cover-letter'}-${profile.basics.name.replace(/[^\p{L}\p{N}]+/gu, '-') || 'applicant'}-${job.company.replace(/[^\p{L}\p{N}]+/gu, '-')}-v${doc.version}.pdf`;
  const pdfPath = join(docsDir(ctx, app.id), base);
  writeFileSync(pdfPath, pdf);
  const warnings = (doc.warnings ?? []).filter((w) => !w.startsWith('PDF is'));
  if (bytes > 1024 * 1024) warnings.push(`PDF is ${(bytes / 1024 / 1024).toFixed(1)} MB (over 1 MB)`);
  ctx.db.update(documents).set({ html, pdfPath, warnings }).where(eq(documents.id, docId)).run();
}

export function currentDocuments(ctx: AppContext, appId: number) {
  const all = ctx.db.select().from(documents).where(eq(documents.applicationId, appId)).orderBy(desc(documents.version)).all();
  const out: Partial<Record<DocumentType, (typeof all)[number]>> = {};
  for (const d of all) if (!out[d.type as DocumentType]) out[d.type as DocumentType] = d;
  return out;
}

function nextVersion(ctx: AppContext, appId: number, type: DocumentType): number {
  return (currentDocuments(ctx, appId)[type]?.version ?? 0) + 1;
}

function factIdsOf(type: DocumentType, content: unknown): string[] {
  if (type === 'cv') {
    const c = content as TailoredCv;
    return [...new Set([...c.summaryFactIds, ...c.sections.flatMap((s) => s.items.flatMap((i) => i.bullets.flatMap((b) => b.factIds)))])];
  }
  if (type === 'cover_letter') return [...new Set((content as CoverLetter).paragraphs.flatMap((p) => p.factIds))];
  return [...new Set((content as FormAnswer[]).flatMap((a) => a.factIds))];
}

// ---------- Generation ----------

export interface GenerateOptions {
  types?: DocumentType[];
  instruction?: string | null;
}

async function generateOne(ctx: AppContext, appId: number, job: JobRow, type: DocumentType, instruction: string | null, extraQuestions: string[] = []) {
  const settings = getSettings(ctx.db);
  const profile = getProfile(ctx.db).data;
  const facts = confirmedFacts(ctx.db);
  if (facts.length === 0) throw new Error('Your profile has no confirmed facts yet. Upload a CV first.');
  const language = resolveLanguage(settings, job);
  const vars = { style_profile: styleProfileText(ctx, language), language };
  const jobInput = { title: job.title, company: job.company, location: job.location, description: job.description.slice(0, 10_000) };
  const conv = CONVENTIONS[settings.cv.country];
  let content: unknown;
  let model: string;
  let warnings: string[];
  if (type === 'cv') {
    const L = labels(language);
    const r = await runTask(
      ctx,
      cvTailorTask,
      {
        job: jobInput,
        language,
        pages: settings.cv.template === 'harvard' ? 1 : settings.cv.pages ?? conv.pages,
        entries: profileEntries(profile),
        facts: factInputs(facts),
        sectionTitles: { experience: L.experience!, education: L.education!, skills: L.skills!, languages: L.languages!, projects: L.projects!, certificates: L.certificates!, additional: L.additional! },
        instruction,
      },
      { vars, applicationId: appId },
    );
    if (!r.ok) throw new Error(`CV: ${r.error.message}`);
    content = anchorToProfile(r.output, profile, language);
    warnings = r.output.gaps.map((g) => `Gap: ${g}`);
    model = r.model;
  } else if (type === 'cover_letter') {
    const r = await runTask(ctx, coverLetterTask, { job: jobInput, language, applicantName: profile.basics.name, facts: factInputs(facts), instruction }, { vars, applicationId: appId });
    if (!r.ok) throw new Error(`Cover letter: ${r.error.message}`);
    content = r.output;
    warnings = r.output.gaps.map((g) => `Gap: ${g}`);
    model = r.model;
  } else {
    const questions = [...commonQuestions(language, job), ...extraQuestions];
    const pref = profile.preferences;
    const r = await runTask(
      ctx,
      formAnswersTask,
      {
        job: jobInput,
        language,
        questions,
        facts: factInputs(facts),
        preferences: { salaryExpectation: pref.salaryExpectation ?? null, noticePeriod: pref.noticePeriod ?? null, workAuthorization: pref.workAuthorization ?? null, motivation: pref.motivation ?? null },
      },
      { vars, applicationId: appId },
    );
    if (!r.ok) throw new Error(`Form answers: ${r.error.message}`);
    content = r.output.answers;
    warnings = r.output.answers.filter((a) => a.gap).map((a) => `Gap: ${a.question}`);
    model = r.model;
  }
  const row = ctx.db
    .insert(documents)
    .values({
      applicationId: appId,
      type,
      language,
      template: type === 'form_answers' ? null : settings.cv.template,
      content,
      factsUsed: factIdsOf(type, content),
      warnings,
      version: nextVersion(ctx, appId, type),
      model,
    })
    .returning({ id: documents.id })
    .get();
  await renderDocument(ctx, row.id);
  return row.id;
}

const inFlight = new Set<number>();

/** Prepare the application package: CV, cover letter, form answers (spec §5.4). */
export async function generatePackage(ctx: AppContext, appId: number, opts: GenerateOptions = {}): Promise<void> {
  if (inFlight.has(appId)) return;
  inFlight.add(appId);
  const app = ctx.db.select().from(applications).where(eq(applications.id, appId)).get();
  if (!app) {
    inFlight.delete(appId);
    return;
  }
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)).get()!;
  const types = opts.types ?? (['cv', 'cover_letter', 'form_answers'] as DocumentType[]);
  try {
    if (app.status === 'shortlisted') setApplicationStatus(ctx.db, appId, 'drafting', 'agent', 'Drafting the application package');
    ctx.bus.invalidate('board', `application:${appId}`);
    const results = await Promise.allSettled(types.map((t) => generateOne(ctx, appId, job, t, opts.instruction ?? null)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const f of failed) addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'draft_failed', message: String(f.reason instanceof Error ? f.reason.message : f.reason) });
    const now = ctx.db.select().from(applications).where(eq(applications.id, appId)).get()!;
    const docs = currentDocuments(ctx, appId);
    if (now.status === 'drafting') {
      if (docs.cv && docs.cover_letter) {
        setApplicationStatus(ctx.db, appId, 'ready', 'agent', 'Package drafted and waiting for your approval');
        const s = getSettings(ctx.db);
        if (s.notifications.draftsReady) notify(ctx, { kind: 'drafts_ready', title: 'Application drafted', body: `${job.title} at ${job.company} is ready for your review.`, link: `/jobs/${appId}` });
        if (s.autoApply.autoApprovePackages) approvePackage(ctx, appId, 'agent');
      } else {
        setApplicationStatus(ctx.db, appId, 'shortlisted', 'agent', 'Drafting failed; see the timeline for details');
      }
    }
    if (!failed.length) addEvent(ctx.db, { applicationId: appId, actor: 'agent', type: 'drafted', message: `Drafted ${types.join(', ').replace(/_/gu, ' ')}` });
  } finally {
    inFlight.delete(appId);
    ctx.bus.invalidate('board', 'summary', 'approvals', `application:${appId}`);
  }
}

export function isDrafting(appId: number): boolean {
  return inFlight.has(appId);
}

// ---------- Edits, approval, style learning ----------

function plainText(type: DocumentType, content: unknown): string {
  if (type === 'cover_letter') {
    const c = content as CoverLetter;
    return [c.greeting, ...c.paragraphs.map((p) => p.text), c.closing].join('\n\n');
  }
  if (type === 'cv') {
    const c = content as TailoredCv;
    return [c.summary ?? '', ...c.sections.flatMap((s) => s.items.flatMap((i) => i.bullets.map((b) => b.text)))].join('\n');
  }
  return (content as FormAnswer[]).map((a) => a.answer).join('\n\n');
}

/** Save the user's edit as a new version; record the diff for style learning. */
export async function saveEdit(ctx: AppContext, docId: number, content: unknown): Promise<number> {
  const doc = ctx.db.select().from(documents).where(eq(documents.id, docId)).get();
  if (!doc) throw new Error('Document not found');
  const type = doc.type as DocumentType;
  const before = plainText(type, doc.content);
  const after = plainText(type, content);
  const row = ctx.db
    .insert(documents)
    .values({
      applicationId: doc.applicationId,
      type,
      language: doc.language,
      template: doc.template,
      content,
      factsUsed: factIdsOf(type, content),
      warnings: doc.warnings,
      version: nextVersion(ctx, doc.applicationId, type),
      model: doc.model,
    })
    .returning({ id: documents.id })
    .get();
  if (before !== after && type !== 'form_answers') {
    ctx.db.insert(styleEdits).values({ documentId: row.id, language: doc.language, before, after }).run();
  }
  addEvent(ctx.db, { applicationId: doc.applicationId, actor: 'user', type: 'document_edited', message: `Edited ${type.replace('_', ' ')} (v${nextVersion(ctx, doc.applicationId, type) - 1})` });
  await renderDocument(ctx, row.id);
  void maybeLearnStyle(ctx, doc.language);
  ctx.bus.invalidate(`application:${doc.applicationId}`, 'approvals');
  return row.id;
}

export const STYLE_EDITS_PER_RULE_RUN = 3;

/** After every few edits, derive style rules and propose them to the user (spec §5.4 step 5). */
export async function maybeLearnStyle(ctx: AppContext, language: string): Promise<void> {
  const pending = ctx.db.select().from(styleEdits).where(and(eq(styleEdits.language, language), isNull(styleEdits.processedAt))).all();
  if (pending.length < STYLE_EDITS_PER_RULE_RUN) return;
  const existing = getStyleProfile(ctx.db, language)?.rules ?? [];
  const r = await runTask(ctx, styleRulesTask, { language, existing, edits: pending.map((e) => ({ before: e.before, after: e.after })) });
  const now = new Date().toISOString();
  for (const e of pending) ctx.db.update(styleEdits).set({ processedAt: now }).where(eq(styleEdits.id, e.id)).run();
  if (r.ok && r.output.rules.length) {
    ctx.db.insert(styleProposals).values({ language, rules: r.output.rules }).run();
    notify(ctx, { kind: 'drafts_ready', title: 'New writing-style rules suggested', body: r.output.rules.join(' · '), link: '/profile' });
    ctx.bus.invalidate('style');
  }
}

export function decideStyleProposal(ctx: AppContext, id: number, accept: boolean, rules?: string[]): void {
  const p = ctx.db.select().from(styleProposals).where(eq(styleProposals.id, id)).get();
  if (!p || p.status !== 'pending') throw new Error('No pending proposal');
  if (accept) {
    const s = getStyleProfile(ctx.db, p.language) ?? { language: p.language, tone: '', formality: '', sentenceLength: '', typicalPhrases: [], avoid: [], rules: [], examples: [], description: '' };
    saveStyleProfile(ctx.db, { ...s, rules: [...new Set([...s.rules, ...(rules ?? p.rules)])] });
  }
  ctx.db.update(styleProposals).set({ status: accept ? 'accepted' : 'rejected' }).where(eq(styleProposals.id, id)).run();
  ctx.bus.invalidate('style');
}

export function approvePackage(ctx: AppContext, appId: number, actor: 'user' | 'agent' = 'user'): void {
  const docs = currentDocuments(ctx, appId);
  const now = new Date().toISOString();
  for (const d of Object.values(docs)) if (d && !d.approvedAt) ctx.db.update(documents).set({ approvedAt: now }).where(eq(documents.id, d.id)).run();
  addEvent(ctx.db, { applicationId: appId, actor, type: 'package_approved', message: actor === 'user' ? 'You approved the application package' : 'Package auto-approved (setting)' });
  ctx.bus.invalidate(`application:${appId}`, 'approvals', 'summary', 'board');
}

export function isPackageApproved(ctx: AppContext, appId: number): boolean {
  const docs = currentDocuments(ctx, appId);
  return !!docs.cv?.approvedAt && !!docs.cover_letter?.approvedAt && (!docs.form_answers || !!docs.form_answers.approvedAt);
}
