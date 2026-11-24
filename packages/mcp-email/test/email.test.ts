import { afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GmailApiProvider, matchEmail, parseLinkedInAlert, parseRawMessage, prefilter, stripQuoted, type MatchCandidate, type RawEmail } from '../src/index.js';

const EML = join(import.meta.dirname, '../../../fixtures/emails/eml');
const load = (f: string) => parseRawMessage(readFileSync(join(EML, f)), { id: f });

describe('parsing', () => {
  it('parses .eml with sender, subject and text', async () => {
    const e = await load('de-rejection.eml');
    expect(e.fromAddress).toBe('noreply@smartrecruiters.com');
    expect(e.subject).toBe('Ihre Bewerbung bei Quarry Health');
    expect(e.text).toContain('Leider');
  });
  it('strips quoted replies', () => {
    expect(stripQuoted('Thanks!\n\nOn Mon, 1 Jan 2026 Alex wrote:\n> old text')).toBe('Thanks!');
  });
});

describe('prefilter', () => {
  const ctx = { companyDomains: ['lumen-robotics.example'], companyNames: ['lumen robotics'] };
  it('passes ATS senders, alerts, company domains and multilingual keywords', async () => {
    expect(prefilter(await load('en-received-greenhouse.eml'), ctx)).toEqual({ pass: true, reason: 'ats_sender' });
    expect(prefilter(await load('en-linkedin-alert.eml'), ctx).reason).toBe('alert_sender');
    expect(prefilter(await load('de-rejection-3.eml'), ctx).reason).toBe('company_domain');
    expect(prefilter(await load('it-rejection.eml'), ctx).reason).toBe('keyword');
    expect(prefilter(await load('pt-rejection.eml'), ctx).reason).toBe('keyword');
  });
  it('drops personal mail', async () => {
    expect(prefilter(await load('en-personal.eml'), ctx).pass).toBe(false);
    expect(prefilter(await load('it-other.eml'), ctx).pass).toBe(false);
  });
});

describe('matching emails to applications', () => {
  const apps: MatchCandidate[] = [
    { applicationId: 1, company: 'Lumen Robotics', title: 'Senior Product Manager, AI Platform', status: 'applied', senderDomains: ['greenhouse.io'], atsRefIds: ['LR-2291'], companyDomain: 'lumen-robotics.example', appliedAt: null },
    { applicationId: 2, company: 'Brightline Pay', title: 'Product Lead, Payments', status: 'applied', senderDomains: [], atsRefIds: [], companyDomain: 'brightlinepay.example', appliedAt: null },
    { applicationId: 3, company: 'Brightline Pay', title: 'Product Manager, Risk', status: 'applied', senderDomains: [], atsRefIds: [], companyDomain: 'brightlinepay.example', appliedAt: null },
  ];
  it('uses reference ids and company names', () => {
    const m = matchEmail({ fromAddress: 'no-reply@greenhouse-mail.io', subject: 'Your application', text: 'Re: LR-2291', company: 'Lumen Robotics', role: null, referenceIds: ['LR-2291'] }, apps);
    expect(m).toMatchObject({ applicationId: 1 });
    expect(m!.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it('does not trust a shared ATS domain alone', () => {
    expect(matchEmail({ fromAddress: 'x@greenhouse-mail.io', subject: 'Hello', text: 'Some text', company: null, role: null, referenceIds: [] }, apps)).toBeNull();
  });
  it('lowers confidence when two applications at the same company are possible', () => {
    const m = matchEmail({ fromAddress: 'jo@brightlinepay.example', subject: 'Next steps', text: 'interview', company: 'Brightline Pay', role: null, referenceIds: [] }, apps);
    expect(m!.confidence).toBeLessThan(0.6);
  });
  it('picks the right one when the role is named', () => {
    const m = matchEmail({ fromAddress: 'jo@brightlinepay.example', subject: 'Product Manager, Risk', text: '', company: 'Brightline Pay', role: 'Product Manager, Risk', referenceIds: [] }, apps);
    expect(m).toMatchObject({ applicationId: 3 });
    expect(m!.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

describe('LinkedIn alerts', () => {
  it('extracts job cards without visiting LinkedIn', async () => {
    const jobs = parseLinkedInAlert(await load('en-linkedin-alert.eml'));
    expect(jobs).toEqual([
      { title: 'Senior Product Manager', company: 'Aurora Labs', location: 'Zurich (Hybrid)', url: 'https://www.linkedin.com/jobs/view/4100000001', sourceJobId: 'linkedin:4100000001' },
      { title: 'Product Lead', company: 'Glacier Bank', location: 'Zurich', url: 'https://www.linkedin.com/jobs/view/4100000002', sourceJobId: 'linkedin:4100000002' },
    ]);
  });
});

describe('Gmail API provider (local fake Gmail server)', () => {
  const raw = readFileSync(join(EML, 'en-interview.eml'));
  const calls: string[] = [];
  let modified: unknown = null;
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url!, 'http://x');
      if (u.pathname.endsWith('/profile')) return res.end(JSON.stringify({ emailAddress: 'alex@example.com', historyId: '500' }));
      if (u.pathname.endsWith('/history')) return res.end(JSON.stringify({ history: [{ messagesAdded: [{ message: { id: 'm2' } }] }], historyId: '600' }));
      if (u.pathname.endsWith('/messages') && req.method === 'GET') return res.end(JSON.stringify({ messages: [{ id: 'm1' }] }));
      if (/\/messages\/m\d$/u.test(u.pathname)) return res.end(JSON.stringify({ id: u.pathname.split('/').pop(), threadId: 't1', labelIds: ['INBOX'], internalDate: '1795000000000', raw: raw.toString('base64url') }));
      if (u.pathname.endsWith('/labels') && req.method === 'GET') return res.end(JSON.stringify({ labels: [{ id: 'L1', name: 'INBOX' }] }));
      if (u.pathname.endsWith('/labels') && req.method === 'POST') return res.end(JSON.stringify({ id: 'L9', name: JSON.parse(body).name }));
      if (u.pathname.endsWith('/modify')) {
        modified = JSON.parse(body);
        return res.end(JSON.stringify({ id: 'm1' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('syncs by time first, then by historyId, and applies labels', async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const p = new GmailApiProvider({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'x' }, 'refresh', { rootUrl: `http://127.0.0.1:${port}/`, accessToken: 'test-access' });
    expect(await p.verify()).toBe('alex@example.com');
    const first = await p.sync(null, { initialDays: 30, max: 10 });
    expect(first.cursor).toBe('500');
    expect(first.messages[0]!.subject).toMatch(/Interview invitation/u);
    expect(calls.some((c) => c.includes('newer_than%3A30d') || c.includes('newer_than:30d'))).toBe(true);
    const second = await p.sync(first.cursor, { initialDays: 30, max: 10 });
    expect(second.cursor).toBe('600');
    expect((second.messages[0] as RawEmail).providerMessageId).toBe('m2');
    await p.addLabel('m1', 'Jobhunter/Interview');
    expect(modified).toEqual({ addLabelIds: ['L9'] });
  });
});
