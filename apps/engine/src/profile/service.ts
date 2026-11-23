import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  addEvent,
  confirmedFacts,
  eq,
  getProfile,
  interviewSessions,
  listStyleSamples,
  profileImports,
  retireFacts,
  saveProfile,
  saveStyleProfile,
  upsertFacts,
  getStyleProfile,
  desc,
} from '@jobhunter/db';
import { normalizeCompany, type Profile, type StyleProfile } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { runTask } from '../agent/runner.js';
import { extractCvText } from './extract-text.js';
import { deriveFacts, profileSummary } from './facts.js';
import {
  cvInterviewTask,
  extractionToProfile,
  interviewSummaryTask,
  profileExtractTask,
  styleAnalyzeTask,
  type InterviewInput,
  type InterviewSummary,
  type InterviewTurn,
} from '../tasks/profile.js';

// ---------- CV import ----------

export async function startImport(ctx: AppContext, file: { filename: string; data: Buffer }, kind: 'cv' | 'linkedin_pdf'): Promise<number> {
  const text = await extractCvText(file.data, file.filename);
  const dir = join(ctx.config.filesDir, 'uploads');
  mkdirSync(dir, { recursive: true });
  const safeName = `${Date.now()}-${file.filename.replace(/[^\w.-]+/gu, '_').slice(-80)}`;
  const filePath = join(dir, safeName);
  writeFileSync(filePath, file.data);
  const row = ctx.db
    .insert(profileImports)
    .values({ kind, filename: file.filename, filePath, text, status: 'extracting' })
    .returning({ id: profileImports.id })
    .get();
  if (text.length < 50) {
    ctx.db
      .update(profileImports)
      .set({ status: 'failed', error: 'Almost no text could be read from this file. Is it a scanned image? Try a DOCX or a text-based PDF.' })
      .where(eq(profileImports.id, row.id))
      .run();
    return row.id;
  }
  void runImport(ctx, row.id, text, kind);
  return row.id;
}

async function runImport(ctx: AppContext, id: number, text: string, kind: 'cv' | 'linkedin_pdf'): Promise<void> {
  const r = await runTask(ctx, profileExtractTask, { text, kind });
  if (r.ok) {
    const proposed = extractionToProfile(r.output);
    ctx.db.update(profileImports).set({ status: 'review', extracted: proposed }).where(eq(profileImports.id, id)).run();
  } else {
    ctx.db.update(profileImports).set({ status: 'failed', error: r.error.message }).where(eq(profileImports.id, id)).run();
  }
  ctx.bus.invalidate('profile-import', 'profile');
}

/** Merge reviewed items into the existing profile; entries that already exist are updated, not duplicated. */
export function mergeProfiles(base: Profile, incoming: Profile): Profile {
  const key = (a: string, b: string) => `${normalizeCompany(a)}|${b.toLowerCase().trim()}`;
  const work = [...base.work];
  for (const w of incoming.work) {
    const i = work.findIndex((x) => key(x.name, x.position) === key(w.name, w.position));
    if (i >= 0) {
      const cur = work[i]!;
      work[i] = { ...cur, ...w, id: cur.id, highlights: [...new Set([...cur.highlights, ...w.highlights])] };
    } else work.push(w);
  }
  const education = [...base.education];
  for (const e of incoming.education) {
    if (!education.some((x) => key(x.institution, x.area ?? '') === key(e.institution, e.area ?? ''))) education.push(e);
  }
  const byName = <T extends { name: string }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.name.toLowerCase() === x.name.toLowerCase()))];
  const languages = [...base.languages, ...incoming.languages.filter((l) => !base.languages.some((x) => x.language.toLowerCase() === l.language.toLowerCase()))];
  const pick = <T>(a: T | undefined, b: T | undefined) => (b !== undefined && b !== '' ? b : a);
  return {
    ...base,
    basics: {
      ...base.basics,
      name: pick(base.basics.name, incoming.basics.name) ?? '',
      label: pick(base.basics.label, incoming.basics.label),
      email: pick(base.basics.email, incoming.basics.email),
      phone: pick(base.basics.phone, incoming.basics.phone),
      url: pick(base.basics.url, incoming.basics.url),
      summary: pick(base.basics.summary, incoming.basics.summary),
      location: incoming.basics.location ?? base.basics.location,
      profiles: [...base.basics.profiles, ...incoming.basics.profiles.filter((p) => !base.basics.profiles.some((x) => x.url === p.url))],
    },
    work,
    education,
    skills: byName(base.skills, incoming.skills),
    languages,
    projects: byName(base.projects, incoming.projects),
    certificates: byName(base.certificates, incoming.certificates),
    achievements: [...base.achievements, ...incoming.achievements.filter((a) => !base.achievements.some((x) => x.text === a.text))],
    interests: [...new Set([...base.interests, ...incoming.interests])],
    preferences: { ...base.preferences, ...Object.fromEntries(Object.entries(incoming.preferences).filter(([, v]) => v !== undefined)) },
  };
}

/** Persist a profile and keep its derived facts in sync. Interview and manual facts are untouched. */
export function commitProfile(ctx: AppContext, data: Profile, source: string): { version: number; facts: number } {
  const version = saveProfile(ctx.db, data, source);
  const derived = deriveFacts(data);
  upsertFacts(
    ctx.db,
    derived.map((f) => ({ ...f, confirmed: true })),
  );
  retireFacts(ctx.db, 'cv', new Set(derived.map((f) => f.id)));
  addEvent(ctx.db, { actor: 'user', type: 'profile_saved', message: `Profile saved (version ${version}, ${source})` });
  ctx.bus.invalidate('profile', 'facts', 'matches');
  return { version, facts: derived.length };
}

export function applyImport(ctx: AppContext, id: number, reviewed: Profile): { version: number; facts: number } {
  const imp = ctx.db.select().from(profileImports).where(eq(profileImports.id, id)).get();
  if (!imp) throw new Error('Import not found');
  const merged = mergeProfiles(getProfile(ctx.db).data, reviewed);
  const res = commitProfile(ctx, merged, imp.kind);
  ctx.db.update(profileImports).set({ status: 'applied' }).where(eq(profileImports.id, id)).run();
  ctx.bus.invalidate('profile-import');
  return res;
}

export function latestImport(ctx: AppContext) {
  return ctx.db.select().from(profileImports).orderBy(desc(profileImports.id)).limit(1).get() ?? null;
}

// ---------- CV interview ----------

export interface InterviewState {
  history: InterviewInput['history'];
  current: InterviewTurn | null;
  summary: InterviewSummary | null;
  goals: string | null;
}

function interviewInput(ctx: AppContext, state: InterviewState): InterviewInput {
  return {
    profileSummary: profileSummary(getProfile(ctx.db).data) || '(empty profile)',
    facts: confirmedFacts(ctx.db).map((f) => ({ id: f.id, text: f.text })),
    history: state.history,
    goals: state.goals,
  };
}

function saveState(ctx: AppContext, id: number, state: InterviewState, status?: string) {
  ctx.db
    .update(interviewSessions)
    .set({ state, updatedAt: new Date().toISOString(), ...(status ? { status } : {}) })
    .where(eq(interviewSessions.id, id))
    .run();
  ctx.bus.invalidate('interview');
}

export function currentInterview(ctx: AppContext) {
  const row = ctx.db.select().from(interviewSessions).orderBy(desc(interviewSessions.id)).limit(1).get();
  if (!row || row.status === 'completed' || row.status === 'abandoned') return null;
  return { id: row.id, status: row.status, state: row.state as InterviewState };
}

export async function startInterview(ctx: AppContext, goals: string | null) {
  for (const s of ctx.db.select().from(interviewSessions).where(eq(interviewSessions.status, 'active')).all()) {
    ctx.db.update(interviewSessions).set({ status: 'abandoned' }).where(eq(interviewSessions.id, s.id)).run();
  }
  const state: InterviewState = { history: [], current: null, summary: null, goals };
  const row = ctx.db.insert(interviewSessions).values({ state }).returning({ id: interviewSessions.id }).get();
  return nextQuestion(ctx, row.id, state);
}

async function nextQuestion(ctx: AppContext, id: number, state: InterviewState) {
  const r = await runTask(ctx, cvInterviewTask, interviewInput(ctx, state));
  if (!r.ok) throw new Error(r.error.message);
  state.current = r.output;
  saveState(ctx, id, state);
  return { id, status: 'active', state };
}

export async function answerInterview(ctx: AppContext, id: number, answer: string | null) {
  const row = ctx.db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).get();
  if (!row) throw new Error('Interview not found');
  const state = row.state as InterviewState;
  if (!state.current?.question) throw new Error('No open question');
  state.history.push({ question: state.current.question, answer: answer?.trim() ? answer.trim() : null, topic: state.current.topic });
  state.current = null;
  if (state.history.length >= 15) return finishInterview(ctx, id, state);
  const res = await nextQuestion(ctx, id, state);
  if (res.state.current?.done) return finishInterview(ctx, id, res.state);
  return res;
}

export async function finishInterview(ctx: AppContext, id: number, given?: InterviewState) {
  const state = given ?? ((ctx.db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).get()?.state as InterviewState | undefined) ?? null);
  if (!state) throw new Error('Interview not found');
  if (!state.history.some((h) => h.answer)) {
    saveState(ctx, id, { ...state, summary: { summary: '', facts: [] } }, 'summarizing');
    return { id, status: 'summarizing', state: { ...state, summary: { summary: '', facts: [] } } };
  }
  const r = await runTask(ctx, interviewSummaryTask, interviewInput(ctx, state));
  if (!r.ok) throw new Error(r.error.message);
  state.summary = r.output;
  state.current = null;
  saveState(ctx, id, state, 'summarizing');
  return { id, status: 'summarizing', state };
}

/** Facts from the interview become usable only after the user confirms the summary (spec §5.1 step 4). */
export function confirmInterview(ctx: AppContext, id: number, facts: { text: string; category: string }[]) {
  const clean = facts.filter((f) => f.text.trim());
  upsertFacts(
    ctx.db,
    clean.map((f) => ({ id: `fi_${randomUUID().slice(0, 12)}`, text: f.text.trim(), category: f.category, source: 'interview' as const, refId: `interview:${id}`, confirmed: true })),
  );
  ctx.db.update(interviewSessions).set({ status: 'completed' }).where(eq(interviewSessions.id, id)).run();
  addEvent(ctx.db, { actor: 'user', type: 'interview_confirmed', message: `Interview confirmed with ${clean.length} facts` });
  ctx.bus.invalidate('interview', 'facts', 'profile');
  return { saved: clean.length };
}

// ---------- Writing style ----------

export async function analyzeStyle(ctx: AppContext, language: string): Promise<StyleProfile> {
  const samples = listStyleSamples(ctx.db, language).map((s) => s.text);
  if (samples.length === 0) throw new Error('Add at least one writing sample for this language first.');
  const r = await runTask(ctx, styleAnalyzeTask, { language, samples: samples.slice(-30) });
  if (!r.ok) throw new Error(r.error.message);
  const existing = getStyleProfile(ctx.db, language);
  const profile: StyleProfile = { language, ...r.output, rules: existing?.rules ?? [] };
  saveStyleProfile(ctx.db, profile);
  ctx.bus.invalidate('style');
  return profile;
}

/** Text block for the {{style_profile}} prompt placeholder. */
export function styleProfileText(ctx: AppContext, language: string): string {
  const s = getStyleProfile(ctx.db, language) ?? getStyleProfile(ctx.db, 'en');
  if (!s) return 'No style profile yet: write clearly, concretely and without clichés.';
  return [
    s.description,
    s.tone && `Tone: ${s.tone}`,
    s.formality && `Formality: ${s.formality}`,
    s.sentenceLength && `Sentences: ${s.sentenceLength}`,
    s.typicalPhrases.length ? `Typical phrases: ${s.typicalPhrases.join(' | ')}` : '',
    s.avoid.length ? `Avoid: ${s.avoid.join('; ')}` : '',
    s.rules.length ? `Rules learned from the user's edits:\n${s.rules.map((r) => `- ${r}`).join('\n')}` : '',
    s.examples.length ? `Examples of the user's own sentences:\n${s.examples.map((e) => `> ${e}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
