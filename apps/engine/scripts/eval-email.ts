/**
 * Email classification eval (spec §5.5 acceptance: ≥90% correct classification and no wrong automatic
 * status change above the confidence threshold).
 *
 *   pnpm eval:email            replay recorded model answers (tests prefilter, matching, status rules)
 *   pnpm eval:email --live     classify with the real model (your Claude login / API key)
 *   pnpm eval:email --live --record   also store the live answers as the new recorded answers
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applications, companies, emails, jobs, updateSettings } from '@jobhunter/db';
import { parseRawMessage } from '@jobhunter/mcp-email';
import { normalizeCompany, normalizeTitle, type EmailClass } from '@jobhunter/shared';
import { createTestContext, type AppContext } from '../src/context.js';
import { FakeBackend } from '../src/agent/backends/fake.js';
import { setBackendOverride } from '../src/agent/runner.js';
import { processEmails } from '../src/email/pipeline.js';
import { eq } from '@jobhunter/db';

interface Recorded {
  classification: EmailClass;
  company: string | null;
  role: string | null;
  confidence: number;
  keySentence: string | null;
  referenceIds: string[];
}
interface Case {
  file: string;
  expected: { classification: EmailClass; applicationId: number | null };
  recorded: Recorded;
}
interface AppFixture {
  id: number;
  company: string;
  title: string;
  status: string;
  senderDomains: string[];
  atsRefIds: string[];
  companyDomain: string;
}

const root = resolve(import.meta.dirname, '../../..');
const dir = join(root, 'fixtures/emails');
const data = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as { applications: AppFixture[]; cases: Case[] };
const live = process.argv.includes('--live');
const record = process.argv.includes('--record');

function seed(ctx: AppContext): void {
  for (const a of data.applications) {
    const co = ctx.db
      .insert(companies)
      .values({ name: a.company, normName: normalizeCompany(a.company), website: `https://${a.companyDomain}` })
      .onConflictDoUpdate({ target: companies.normName, set: { website: `https://${a.companyDomain}` } })
      .returning({ id: companies.id })
      .get();
    const url = `https://jobs.example/${a.id}`;
    const job = ctx.db
      .insert(jobs)
      .values({ companyId: co.id, company: a.company, normCompany: normalizeCompany(a.company), title: a.title, normTitle: normalizeTitle(a.title), url, canonicalUrl: url, atsType: 'generic', atsJobId: url, contentHash: url })
      .returning({ id: jobs.id })
      .get();
    ctx.db.insert(applications).values({ id: a.id, jobId: job.id, status: a.status, appliedAt: '2026-10-20T09:00:00.000Z', senderDomains: a.senderDomains, atsRefIds: a.atsRefIds }).run();
  }
}

async function liveContext(): Promise<AppContext> {
  const ctx = createTestContext();
  const mode = process.env.JOBHUNTER_AUTH_MODE === 'api_key' ? 'api_key' : 'subscription';
  updateSettings(ctx.db, { auth: { mode } });
  if (mode === 'api_key' && process.env.ANTHROPIC_API_KEY) await ctx.secrets.set('anthropic_api_key', process.env.ANTHROPIC_API_KEY);
  return ctx;
}

let correctClass = 0;
let correctMatch = 0;
let matchTotal = 0;
let autoChanges = 0;
let wrongAuto = 0;
let review = 0;
const failures: string[] = [];
const newRecorded = new Map<string, Recorded>();

for (const c of data.cases) {
  const raw = await parseRawMessage(readFileSync(join(dir, 'eml', c.file)), { id: c.file });
  const ctx = live ? await liveContext() : createTestContext();
  updateSettings(ctx.db, { email: { applyLabels: false } });
  seed(ctx);
  if (!live) {
    const fake = new FakeBackend();
    fake.on('email_classify', (req) => {
      const keys = [...req.prompt.matchAll(/<email key="(\d+)">/gu)].map((m) => m[1]!);
      return { results: keys.map((key) => ({ key, ...c.recorded })) };
    });
    fake.on('alert_parse', () => ({ jobs: [] }));
    fake.on('match_score', () => ({ results: [] }));
    setBackendOverride(ctx, fake);
  }
  const before = new Map(ctx.db.select().from(applications).all().map((a) => [a.id, a.status]));
  const [out] = await processEmails(ctx, [raw], null, 'eval');
  const stored = out && out.emailId ? ctx.db.select().from(emails).where(eq(emails.id, out.emailId)).get() : null;
  const predicted: EmailClass = out?.action === 'filtered' ? 'other' : ((stored?.classification as EmailClass | null) ?? 'other');
  if (live && record && stored) {
    newRecorded.set(c.file, { classification: predicted, company: stored.company, role: stored.role, confidence: stored.confidence ?? 0, keySentence: stored.keySentence, referenceIds: [] });
  }
  if (predicted === c.expected.classification) correctClass++;
  else failures.push(`${c.file}: expected ${c.expected.classification}, got ${predicted}`);
  if (c.expected.applicationId !== null && ['application_received', 'rejection', 'interview_invite', 'assessment', 'offer'].includes(c.expected.classification)) {
    matchTotal++;
    const linked = stored?.applicationId ?? null;
    if (linked === c.expected.applicationId) correctMatch++;
    else failures.push(`${c.file}: linked to ${linked ?? 'nothing'}, expected application ${c.expected.applicationId}`);
  }
  if (out?.action === 'review') review++;
  for (const a of ctx.db.select().from(applications).all()) {
    if (before.get(a.id) !== a.status) {
      autoChanges++;
      const ok = a.id === c.expected.applicationId && predicted === c.expected.classification;
      if (!ok) {
        wrongAuto++;
        failures.push(`${c.file}: WRONG automatic change of application ${a.id} to ${a.status}`);
      }
    }
  }
  ctx.dbHandle.close();
}

if (live && record) {
  for (const c of data.cases) {
    const r = newRecorded.get(c.file);
    if (r) c.recorded = { ...c.recorded, ...r };
  }
  writeFileSync(join(dir, 'cases.json'), `${JSON.stringify(data, null, 2)}\n`);
}

const n = data.cases.length;
const acc = correctClass / n;
console.log(`Email eval (${live ? 'live model' : 'recorded answers'}), ${n} emails`);
console.log(`  classification accuracy: ${(acc * 100).toFixed(1)}% (${correctClass}/${n})`);
console.log(`  correct application link: ${correctMatch}/${matchTotal}`);
console.log(`  automatic status changes: ${autoChanges}, wrong: ${wrongAuto}`);
console.log(`  sent to review queue: ${review}`);
if (failures.length) console.log(`\n${failures.map((f) => `  - ${f}`).join('\n')}`);
const pass = acc >= 0.9 && wrongAuto === 0;
console.log(pass ? '\nPASS (≥90% accuracy, no wrong automatic changes)' : '\nFAIL');
process.exit(pass ? 0 : 1);
