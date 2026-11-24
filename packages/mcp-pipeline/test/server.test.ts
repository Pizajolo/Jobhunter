import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { applications, events, eq, jobs, openTestDb, setApplicationStatus, type Db } from '@jobhunter/db';
import { normalizeCompany, normalizeTitle } from '@jobhunter/shared';
import { createPipelineMcpServer } from '../src/server.js';

function seed(db: Db) {
  const add = (company: string, title: string) => {
    const job = db
      .insert(jobs)
      .values({ company, normCompany: normalizeCompany(company), title, normTitle: normalizeTitle(title), location: 'Zurich', url: `https://x.example/${title}`, canonicalUrl: `https://x.example/${title}`, atsType: 'greenhouse', contentHash: title })
      .returning({ id: jobs.id })
      .get();
    return db.insert(applications).values({ jobId: job.id }).returning({ id: applications.id }).get().id;
  };
  const a = add('Lumen Robotics', 'Product Manager');
  const b = add('Halden Group', 'Strategy Consultant');
  setApplicationStatus(db, a, 'shortlisted', 'user', 'shortlisted');
  return { a, b };
}

async function connect(db: Db, allowWrites = false) {
  const server = createPipelineMcpServer(db, { allowWrites });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { error: r.isError === true, text: r.content[0]!.text, json: () => JSON.parse(r.content[0]!.text) as unknown };
  };
  return { client, call };
}

describe('mcp-pipeline server', () => {
  it('is read-only by default and answers pipeline questions', async () => {
    const { db } = openTestDb();
    const { a } = seed(db);
    const { client, call } = await connect(db);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_application', 'list_applications', 'pipeline_summary']);
    expect((await call('pipeline_summary')).json()).toMatchObject({ total: 2, columns: { found: 1, shortlisted: 1 } });
    const list = (await call('list_applications', { query: 'lumen' })).json() as { id: number; status: string }[];
    expect(list).toEqual([expect.objectContaining({ id: a, status: 'shortlisted', company: 'Lumen Robotics' })]);
    expect(((await call('list_applications', { statuses: ['found'] })).json() as unknown[]).length).toBe(1);
    const detail = (await call('get_application', { id: a })).json() as { timeline: { message: string }[] };
    expect(detail.timeline.map((e) => e.message)).toContain('shortlisted');
    expect((await call('get_application', { id: 999 })).error).toBe(true);
  });

  it('with writes allowed, still follows the state machine', async () => {
    const { db } = openTestDb();
    const { a, b } = seed(db);
    const { call } = await connect(db, true);
    // only the user may mark an application as applied
    const refused = await call('update_status', { id: a, status: 'applied', reason: 'client says so' });
    expect(refused.error).toBe(true);
    expect(db.select().from(applications).where(eq(applications.id, a)).get()!.status).toBe('shortlisted');
    const ok = await call('update_status', { id: b, status: 'dismissed', reason: 'Not a fit' });
    expect(ok.error).toBe(false);
    expect(db.select().from(applications).where(eq(applications.id, b)).get()!.status).toBe('dismissed');
    await call('add_note', { id: a, text: 'Ask about the hybrid policy' });
    expect(db.select().from(applications).where(eq(applications.id, a)).get()!.notes).toBe('Ask about the hybrid policy');
    expect(db.select().from(events).where(eq(events.applicationId, a)).all().some((e) => e.type === 'note')).toBe(true);
  });
});
