import { describe, expect, it } from 'vitest';
import { companies, notifications, saveProfile, saveSearchProfile, updateSettings, upsertFacts } from '@jobhunter/db';
import { EMPTY_PROFILE, EMPTY_SEARCH_PROFILE } from '@jobhunter/shared';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { runDiscovery, storeSuggestions } from '../src/scan/discovery.js';
import { addCompany } from '../src/scan/companies.js';
import { webGuard } from '../src/agent/backends/agent-sdk.js';
import { PoliteFetcher } from '../src/scan/fetcher.js';
import { fixtureFetch } from './support/fixture-fetch.js';
import { testApp } from './support/helpers.js';

function seed(ctx: Awaited<ReturnType<typeof testApp>>['ctx']) {
  saveProfile(ctx.db, { ...EMPTY_PROFILE, basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example' } }, 'manual');
  upsertFacts(ctx.db, [{ id: 'f1', text: 'Senior Product Manager at Fictional Data AG', source: 'manual', confirmed: true }]);
  saveSearchProfile(ctx.db, { ...EMPTY_SEARCH_PROFILE, roles: ['Product Manager'], locations: ['Lisbon'], industries: ['climate tech'], excludedCompanies: ['Badco'] });
}

const pre = (tool: string, input: unknown) =>
  webGuard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 't', session_id: 's', transcript_path: '', cwd: '' } as HookInput, 't', {
    signal: new AbortController().signal,
  });

describe('company discovery', () => {
  it('blocks LinkedIn in the web tools', async () => {
    const denied = (o: unknown) => (o as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === 'deny';
    expect(denied(await pre('WebFetch', { url: 'https://www.linkedin.com/company/x/jobs' }))).toBe(true);
    expect(denied(await pre('WebFetch', { url: 'https://de.linkedin.com/jobs' }))).toBe(true);
    expect(denied(await pre('WebFetch', { url: 'https://lumen.example/careers' }))).toBe(false);
    expect(denied(await pre('WebSearch', { query: 'site:linkedin.com climate tech Lisbon' }))).toBe(true);
    const search = (await pre('WebSearch', { query: 'climate tech startups Lisbon' })) as unknown as { hookSpecificOutput: { updatedInput: { blocked_domains: string[] } } };
    expect(search.hookSpecificOutput.updatedInput.blocked_domains).toContain('linkedin.com');
  });

  it('suggests new companies with a reason and skips known, excluded and LinkedIn ones', async () => {
    const { ctx, fake, app } = await testApp();
    seed(ctx);
    const fetcher = new PoliteFetcher(ctx.db, { minIntervalMs: 0, maxPagesPerDomainPerDay: 99, freshMs: 0, fetchImpl: fixtureFetch({}).impl });
    await addCompany(ctx, { name: 'Lumen Robotics', careersUrl: 'https://boards.greenhouse.io/lumen' }, fetcher);
    fake.on('company_discovery', (req) => {
      expect(req.webTools).toBe(true);
      expect(req.prompt).toContain('Lumen Robotics');
      expect(req.prompt).toContain('Badco');
      return {
        companies: [
          { name: 'Solara Grid', website: 'https://solaragrid.example', careersUrl: 'https://jobs.ashbyhq.com/solara', location: 'Lisbon', reason: 'Battery storage startup hiring PMs' },
          { name: 'Tidewater Energy', website: 'https://tidewater.example', careersUrl: null, location: null, reason: 'Offshore wind software' },
          { name: 'Ghost Co', website: 'https://www.linkedin.com/company/ghost', careersUrl: null, location: null, reason: 'x' },
          { name: 'Badco', website: 'https://badco.example', careersUrl: null, location: null, reason: 'excluded by the user' },
        ],
      };
    });
    const r = await runDiscovery(ctx, 'manual');
    expect(r).toMatchObject({ ok: true, suggested: 2, added: 0, skipped: 2 });
    const rows = ctx.db.select().from(companies).all();
    const solara = rows.find((c) => c.name === 'Solara Grid')!;
    expect(solara).toMatchObject({ watchStatus: 'suggested', source: 'discovered', careersUrl: 'https://jobs.ashbyhq.com/solara' });
    expect(solara.discoveryReason).toContain('Battery storage');
    expect(rows.some((c) => c.name === 'Ghost Co')).toBe(false);
    expect(ctx.db.select().from(notifications).all().some((n) => n.title.includes('2 companies suggested'))).toBe(true);

    // a second run never suggests the same companies again
    fake.on('company_discovery', () => ({
      companies: [{ name: 'Solara Grid', website: null, careersUrl: 'https://solaragrid.example/jobs', location: null, reason: 'again' }],
    }));
    const again = await runDiscovery(ctx, 'manual');
    expect(again).toMatchObject({ ok: true, suggested: 0, skipped: 1 });

    const res = await app.inject({ method: 'POST', url: '/api/discovery/run' });
    expect(res.json()).toEqual({ started: true });
  });

  it('dedupes by website domain and can add straight to the watch list', async () => {
    const { ctx } = await testApp();
    const fetcher = new PoliteFetcher(ctx.db, { minIntervalMs: 0, maxPagesPerDomainPerDay: 99, freshMs: 0, fetchImpl: fixtureFetch({ 'https://newco.example/careers': { status: 200, body: '<html>Jobs</html>' } }).impl });
    await addCompany(ctx, { name: 'Wavelength', careersUrl: 'https://wavelength.example/jobs' }, fetcher);
    const out = await storeSuggestions(
      ctx,
      {
        companies: [
          { name: 'Wavelength Labs GmbH', website: 'https://www.wavelength.example', careersUrl: null, location: null, reason: 'same site' },
          { name: 'NewCo', website: null, careersUrl: 'https://newco.example/careers', location: 'Zurich', reason: 'fits' },
        ],
      },
      true,
      fetcher,
    );
    expect(out).toEqual({ added: 1, suggested: 0, skipped: 1 });
    expect(ctx.db.select().from(companies).all().find((c) => c.name === 'NewCo')?.watchStatus).toBe('watching');
  });

  it('does nothing when turned off or without a search profile', async () => {
    const { ctx, fake } = await testApp();
    expect((await runDiscovery(ctx, 'manual')).message).toMatch(/search profile/u);
    updateSettings(ctx.db, { discovery: { enabled: false } });
    expect((await runDiscovery(ctx, 'manual')).message).toMatch(/off/u);
    expect(fake.calls).toHaveLength(0);
  });
});
