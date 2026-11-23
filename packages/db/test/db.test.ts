import { describe, expect, it } from 'vitest';
import { openTestDb, getSettings, updateSettings, addEvent, listEvents, jobs, applications } from '../src/index.js';

describe('database', () => {
  it('migrates an empty database', () => {
    const h = openTestDb();
    const tables = h.sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of ['profile', 'profile_facts', 'style_profile', 'search_profile', 'companies', 'sources', 'jobs', 'matches', 'applications', 'documents', 'emails', 'events', 'chat_messages', 'settings']) {
      expect(names).toContain(t);
    }
    h.close();
  });

  it('stores and validates settings', () => {
    const { db } = openTestDb();
    expect(getSettings(db).autoApply.level).toBe('prepare');
    const s = updateSettings(db, { autoApply: { level: 'submit' }, language: 'de' });
    expect(s.autoApply.level).toBe('submit');
    expect(s.autoApply.dailyCap).toBe(5);
    expect(getSettings(db).language).toBe('de');
    expect(() => updateSettings(db, { matchThresholdShow: 500 })).toThrow();
    expect(getSettings(db).matchThresholdShow).toBe(60);
  });

  it('enforces foreign keys and records events', () => {
    const { db } = openTestDb();
    expect(() => db.insert(applications).values({ jobId: 999 }).run()).toThrow();
    const job = db
      .insert(jobs)
      .values({ company: 'A', normCompany: 'a', title: 'T', normTitle: 't', url: 'https://a', canonicalUrl: 'https://a', atsType: 'generic', contentHash: 'h' })
      .returning()
      .get();
    const app = db.insert(applications).values({ jobId: job.id }).returning().get();
    addEvent(db, { applicationId: app.id, actor: 'user', type: 'note', message: 'hello' });
    expect(listEvents(db, app.id)).toHaveLength(1);
    expect(app.senderDomains).toEqual([]);
  });
});
