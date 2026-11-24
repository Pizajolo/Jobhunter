import { describe, expect, it } from 'vitest';
import { confirmedFacts, getProfile, interviewSessions } from '@jobhunter/db';
import type { Cassette } from '../src/agent/cassette.js';
import { extractCvText } from '../src/profile/extract-text.js';
import { deriveFacts } from '../src/profile/facts.js';
import { mergeProfiles } from '../src/profile/service.js';
import { checkExtraction, extractionToProfile, interviewSummaryTask, type Extraction } from '../src/tasks/profile.js';
import { fixture, fixtureJson, testApp } from './support/helpers.js';

const extract = fixtureJson<Cassette>('llm/profile_extract/alex-example.json');

describe('CV text extraction', () => {
  it('reads PDF and DOCX', async () => {
    const pdf = await extractCvText(fixture('cv/alex-example.pdf'), 'cv.pdf');
    expect(pdf).toContain('Fictional Data AG');
    expect(pdf).toContain('CHF 1.2M');
    const docx = await extractCvText(fixture('cv/alex-example.docx'), 'cv.docx');
    expect(docx).toContain('Example Technical University');
  });
  it('rejects other formats', async () => {
    await expect(extractCvText(Buffer.from('x'), 'cv.png')).rejects.toThrow(/PDF or DOCX/u);
  });
});

describe('truthfulness checks on extraction', () => {
  const out = extract.output as Extraction;
  const input = extract.input as { text: string };
  it('accepts a faithful extraction', () => {
    expect(checkExtraction(out, input)).toEqual([]);
  });
  it('rejects invented employers and numbers', () => {
    const bad = structuredClone(out);
    bad.work.push({ employer: 'Google', position: 'CEO', location: null, startDate: null, endDate: null, summary: null, highlights: ['Grew revenue by 900%'] });
    const problems = checkExtraction(bad, input);
    expect(problems.join(' ')).toMatch(/Google/u);
    expect(problems.join(' ')).toMatch(/900/u);
  });
  it('ignores separator differences in numbers', () => {
    const ok = structuredClone(out);
    ok.work[0]!.highlights[1] = 'Grew annual recurring revenue from CHF 1,2M to CHF 3,5M in two years.';
    expect(checkExtraction(ok, input)).toEqual([]);
  });
});

describe('facts', () => {
  it('derives stable atomic facts from the profile', () => {
    const p = extractionToProfile(extract.output as Extraction);
    const facts = deriveFacts(p);
    expect(facts.some((f) => f.text.includes('Led a team of 6 engineers'))).toBe(true);
    expect(facts.some((f) => f.text.startsWith('Senior Product Manager at Fictional Data AG'))).toBe(true);
    expect(deriveFacts(p).map((f) => f.id)).toEqual(facts.map((f) => f.id));
  });
  it('merges a second import without duplicating roles', () => {
    const p = extractionToProfile(extract.output as Extraction);
    const again = extractionToProfile(extract.output as Extraction);
    again.work[0]!.highlights.push('Hired 2 engineers.');
    const merged = mergeProfiles(p, again);
    expect(merged.work).toHaveLength(2);
    expect(merged.work[0]!.highlights).toContain('Hired 2 engineers.');
    expect(merged.skills).toHaveLength(5);
  });
});

describe('profile API', () => {
  it('uploads a CV, extracts it, and saves confirmed facts only after review', async () => {
    const { app, ctx, fake } = await testApp();
    fake.on('profile_extract', () => extract.output);
    const form = new FormData();
    form.append('kind', 'cv');
    form.append('file', new Blob([new Uint8Array(fixture('cv/alex-example.pdf'))], { type: 'application/pdf' }), 'alex.pdf');
    const res = await app.inject({ method: 'POST', url: '/api/profile/imports', payload: form });
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: number };
    let imp: { status: string; extracted: unknown } = { status: 'extracting', extracted: null };
    for (let i = 0; i < 100 && imp.status === 'extracting'; i++) {
      imp = (await app.inject({ method: 'GET', url: `/api/profile/imports/${id}` })).json();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(imp.status).toBe('review');
    expect(confirmedFacts(ctx.db)).toHaveLength(0);
    // the user deletes one skill in the review
    const reviewed = imp.extracted as { skills: unknown[] };
    reviewed.skills = reviewed.skills.slice(1);
    const applied = await app.inject({ method: 'POST', url: `/api/profile/imports/${id}/apply`, payload: { profile: reviewed } });
    expect(applied.statusCode).toBe(200);
    expect(getProfile(ctx.db).data.skills).toHaveLength(4);
    const facts = confirmedFacts(ctx.db);
    expect(facts.length).toBeGreaterThan(5);
    expect(facts.some((f) => f.text.includes('Product discovery'))).toBe(false);
  });

  it('runs the interview one question at a time and saves facts after confirmation', async () => {
    const { app, ctx, fake } = await testApp();
    fake.on(
      'cv_interview',
      () => ({ done: false, question: 'What did you own at Fictional Data AG?', topic: 'responsibility', why: 'x' }),
      () => ({ done: false, question: 'What notice period do you have?', topic: 'preference', why: 'x' }),
      () => ({ done: true, question: null, topic: null, why: null }),
    );
    fake.on('interview_summary', () => ({
      summary: 'ok',
      facts: [
        { text: 'Owned the roadmap at Fictional Data AG', category: 'responsibility', basedOnQuestion: 0 },
        { text: 'Notice period: 3 months', category: 'preference', basedOnQuestion: 1 },
      ],
    }));
    const start = (await app.inject({ method: 'POST', url: '/api/interview/start', payload: {} })).json();
    expect(start.state.current.question).toMatch(/Fictional Data/u);
    const second = (await app.inject({ method: 'POST', url: `/api/interview/${start.id}/answer`, payload: { answer: 'The roadmap' } })).json();
    expect(second.state.current.question).toMatch(/notice/u);
    const done = (await app.inject({ method: 'POST', url: `/api/interview/${start.id}/answer`, payload: { answer: '3 months' } })).json();
    expect(done.status).toBe('summarizing');
    expect(done.state.summary.facts).toHaveLength(2);
    expect(confirmedFacts(ctx.db)).toHaveLength(0);
    await app.inject({ method: 'POST', url: `/api/interview/${start.id}/confirm`, payload: { facts: [done.state.summary.facts[1]] } });
    const facts = confirmedFacts(ctx.db);
    expect(facts.map((f) => f.text)).toEqual(['Notice period: 3 months']);
    expect(facts[0]!.source).toBe('interview');
    expect(ctx.db.select().from(interviewSessions).all()[0]!.status).toBe('completed');
  });

  it('rejects interview facts with numbers the user never said', () => {
    const input = { profileSummary: '', facts: [], goals: null, history: [{ question: 'Team size?', answer: 'about six people', topic: null }] };
    const problems = interviewSummaryTask.check!({ summary: '', facts: [{ text: 'Led 12 people', category: 'achievement', basedOnQuestion: 0 }] }, input);
    expect(problems.join()).toMatch(/12/u);
  });

  it('builds a style profile from samples', async () => {
    const { app, fake } = await testApp();
    const style = fixtureJson<Cassette>('llm/style_analyze/english-samples.json');
    fake.on('style_analyze', () => style.output);
    for (const t of (style.input as { samples: string[] }).samples) {
      await app.inject({ method: 'POST', url: '/api/style/samples', payload: { language: 'en', text: t } });
    }
    const res = await app.inject({ method: 'POST', url: '/api/style/analyze', payload: { language: 'en' } });
    expect(res.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/api/style' })).json();
    expect(list.profiles[0].tone).toContain('direct');
  });
});
