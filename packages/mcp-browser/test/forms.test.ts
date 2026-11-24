import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { canAutoSubmit, prepareApplication, submitApplication, type ApplyData } from '../src/index.js';

const FORMS = join(import.meta.dirname, '../../../fixtures/forms');
let server: http.Server;
let base = '';
let browser: Browser;
const tmp = mkdtempSync(join(tmpdir(), 'jh-apply-'));
const cv = join(tmp, 'CV-Alex-Example.pdf');
const letter = join(tmp, 'Cover-letter-Alex-Example.pdf');
writeFileSync(cv, '%PDF-1.4 test');
writeFileSync(letter, '%PDF-1.4 test');

const data: ApplyData = {
  firstName: 'Alex',
  lastName: 'Example',
  email: 'alex@example.com',
  phone: '+41 00 000 00 00',
  city: 'Zurich',
  linkedin: 'https://linkedin.example/in/alex',
  website: null,
  currentCompany: 'Fictional Data AG',
  cvPath: cv,
  letterPath: letter,
  letterText: 'Dear hiring team, …',
  answers: [
    { question: 'Why do you want to work at Lumen Robotics?', answer: 'Because I build platforms other teams rely on.', factIds: ['f1'], gap: false },
    { question: 'What are your salary expectations?', answer: '', factIds: [], gap: true },
    { question: 'What is your notice period / earliest start date?', answer: '3 months', factIds: ['f2'], gap: false },
    { question: 'Are you authorized to work in this country?', answer: 'Yes', factIds: ['f3'], gap: false },
  ],
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = (req.url ?? '/').split('?')[0]!.replace(/^\//u, '') || 'greenhouse.html';
    try {
      const body = readFileSync(join(FORMS, file));
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function prepare(form: string) {
  const page = await browser.newPage();
  const r = await prepareApplication(page, { url: `${base}/${form}`, data, timeoutMs: 10_000 });
  return { page, r };
}

describe('mock application forms', () => {
  it('Greenhouse-like: fills everything it knows, flags the salary gap, submits', async () => {
    const { page, r } = await prepare('greenhouse.html');
    expect(r.blocker).toBeNull();
    expect(r.readyToSubmit).toBe(true);
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel['First Name']).toBe('Alex');
    expect(byLabel['Resume/CV']).toBe('CV-Alex-Example.pdf');
    expect(byLabel['Cover Letter']).toBe('Cover-letter-Alex-Example.pdf');
    expect(byLabel['Why do you want to work at Lumen Robotics?']).toMatch(/platforms/u);
    expect(byLabel['What are your salary expectations?']).toBeNull(); // gap: left empty
    expect(byLabel['Are you legally authorized to work in Switzerland?']).toBe('Yes');
    expect(r.unresolvedRequired).toHaveLength(0);
    const s = await submitApplication(page);
    expect(s.submitted).toBe(true);
    const sent = (await page.evaluate(() => (window as unknown as { __submitted: Record<string, unknown> }).__submitted)) as Record<string, unknown>;
    expect(sent['job_application[email]']).toBe('alex@example.com');
  });

  it('Lever-like: full name, cover letter text, resume', async () => {
    const { page, r } = await prepare('lever.html');
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel['Full name']).toBe('Alex Example');
    expect(byLabel['Resume/CV']).toBe('CV-Alex-Example.pdf');
    expect(byLabel['Additional information']).toMatch(/Dear hiring team/u);
    expect(byLabel['Current company']).toBe('Fictional Data AG');
    expect(r.readyToSubmit).toBe(true);
    expect((await submitApplication(page)).submitted).toBe(true);
  });

  it('Ashby-like: notice period from the approved answers; unknown radio left empty', async () => {
    const { r } = await prepare('ashby.html');
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel['What is your notice period?']).toBe('3 months');
    expect(byLabel['How did you hear about us?']).toBeNull();
    expect(r.readyToSubmit).toBe(true);
  });

  it('Workday-like multi-step: walks through steps and stops at review', async () => {
    const { page, r } = await prepare('workday.html');
    expect(r.blocker).toBeNull();
    expect(r.steps).toBe(4);
    expect(r.readyToSubmit).toBe(true);
    expect(r.fields.find((f) => f.label === 'What is your notice period?')?.value).toBe('3 months');
    expect(await page.getByRole('heading', { name: 'Review' }).isVisible()).toBe(true);
    expect((await submitApplication(page)).submitted).toBe(true);
  });

  it('stops at a CAPTCHA', async () => {
    const { r } = await prepare('captcha.html');
    expect(r.blocker).toBe('captcha');
    expect(r.readyToSubmit).toBe(false);
  });

  it('stops at a login wall and never types a password', async () => {
    const { page, r } = await prepare('login.html');
    expect(r.blocker).toBe('login');
    expect(await page.locator('#p').inputValue()).toBe('');
  });

  it('flags unknown required fields and consent boxes', async () => {
    const { r } = await prepare('unknown.html');
    expect(r.unresolvedRequired.map((f) => f.label).sort()).toEqual(['Date of birth', 'I agree to the processing of my data for this application']);
  });

  it('follows the Apply link from a posting page', async () => {
    const { r } = await prepare('posting.html');
    expect(r.url).toMatch(/greenhouse\.html$/u);
    expect(r.readyToSubmit).toBe(true);
  });
});

describe('auto-submit policy', () => {
  const ok = { level: 'submit' as const, score: 90, minScore: 85, packageApproved: true, autoApprovePackages: false, host: 'boards.greenhouse.io', excludedDomains: ['linkedin.com'], submittedToday: 0, dailyCap: 5, blocker: null, unresolvedRequired: 0 };
  it('submits only when every condition holds', () => {
    expect(canAutoSubmit(ok).submit).toBe(true);
    expect(canAutoSubmit({ ...ok, level: 'prepare' }).submit).toBe(false);
    expect(canAutoSubmit({ ...ok, score: 80 }).submit).toBe(false);
    expect(canAutoSubmit({ ...ok, packageApproved: false }).submit).toBe(false);
    expect(canAutoSubmit({ ...ok, packageApproved: false, autoApprovePackages: true }).submit).toBe(true);
    expect(canAutoSubmit({ ...ok, submittedToday: 5 }).submit).toBe(false);
    expect(canAutoSubmit({ ...ok, blocker: 'captcha' })).toEqual({ submit: false, reason: 'captcha' });
    expect(canAutoSubmit({ ...ok, unresolvedRequired: 1 }).reason).toBe('unknown_fields');
    expect(canAutoSubmit({ ...ok, host: 'www.linkedin.com' }).reason).toBe('excluded_site');
  });
});
