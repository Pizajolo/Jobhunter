import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  diffValues,
  EMPTY_PROFILE,
  EMPTY_SEARCH_PROFILE,
  ProfileSchema,
  SearchProfileSchema,
  StyleProfileSchema,
  type Profile,
  type ProfileFact,
  type SearchProfile,
  type StyleProfile,
} from '@jobhunter/shared';
import type { Db } from '../client.js';
import { profile, profileFacts, profileVersions, searchProfile, styleProfile, styleSamples } from '../schema.js';

export function getProfile(db: Db): { data: Profile; version: number } {
  const row = db.select().from(profile).where(eq(profile.id, 1)).get();
  if (!row) return { data: EMPTY_PROFILE, version: 0 };
  return { data: ProfileSchema.parse(row.data), version: row.version };
}

/** Save a new profile version (every change is versioned, spec §4). */
export function saveProfile(db: Db, data: Profile, source: string): number {
  const parsed = ProfileSchema.parse(data);
  return db.transaction((tx) => {
    const current = tx.select().from(profile).where(eq(profile.id, 1)).get();
    const version = (current?.version ?? 0) + 1;
    const diff = diffValues(current?.data ?? EMPTY_PROFILE, parsed);
    tx.insert(profile)
      .values({ id: 1, data: parsed, version })
      .onConflictDoUpdate({ target: profile.id, set: { data: parsed, version, updatedAt: new Date().toISOString() } })
      .run();
    tx.insert(profileVersions).values({ version, data: parsed, diff, source }).run();
    return version;
  });
}

export function profileHistory(db: Db, limit = 50) {
  return db
    .select({ version: profileVersions.version, source: profileVersions.source, createdAt: profileVersions.createdAt, diff: profileVersions.diff })
    .from(profileVersions)
    .orderBy(desc(profileVersions.version))
    .limit(limit)
    .all();
}

function toFact(r: typeof profileFacts.$inferSelect): ProfileFact {
  return {
    id: r.id,
    text: r.text,
    source: r.source as ProfileFact['source'],
    category: r.category ?? undefined,
    refId: r.refId ?? undefined,
    confirmedAt: r.confirmedAt,
  };
}

/** Facts the generators may use: confirmed by the user and not deleted (spec §2.4). */
export function confirmedFacts(db: Db): ProfileFact[] {
  return db
    .select()
    .from(profileFacts)
    .where(and(isNotNull(profileFacts.confirmedAt), isNull(profileFacts.deletedAt)))
    .orderBy(asc(profileFacts.createdAt))
    .all()
    .map(toFact);
}

export function allFacts(db: Db): ProfileFact[] {
  return db.select().from(profileFacts).where(isNull(profileFacts.deletedAt)).orderBy(asc(profileFacts.createdAt)).all().map(toFact);
}

export function upsertFacts(db: Db, facts: { id: string; text: string; source: ProfileFact['source']; category?: string; refId?: string; confirmed: boolean }[]): void {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const f of facts) {
      tx.insert(profileFacts)
        .values({ id: f.id, text: f.text, source: f.source, category: f.category ?? null, refId: f.refId ?? null, confirmedAt: f.confirmed ? now : null })
        .onConflictDoUpdate({
          target: profileFacts.id,
          set: { text: f.text, category: f.category ?? null, refId: f.refId ?? null, confirmedAt: f.confirmed ? now : null, deletedAt: null },
        })
        .run();
    }
  });
}

export function deleteFact(db: Db, id: string): void {
  db.update(profileFacts).set({ deletedAt: new Date().toISOString() }).where(eq(profileFacts.id, id)).run();
}

/** Remove derived facts of one source that are no longer backed by the profile. */
export function retireFacts(db: Db, source: ProfileFact['source'], keepIds: Set<string>): number {
  const rows = db.select().from(profileFacts).where(and(eq(profileFacts.source, source), isNull(profileFacts.deletedAt))).all();
  let n = 0;
  for (const r of rows) {
    if (!keepIds.has(r.id)) {
      deleteFact(db, r.id);
      n++;
    }
  }
  return n;
}

export function getStyleProfiles(db: Db): StyleProfile[] {
  return db.select().from(styleProfile).all().map((r) => StyleProfileSchema.parse(r.data));
}

export function getStyleProfile(db: Db, language: string): StyleProfile | null {
  const row = db.select().from(styleProfile).where(eq(styleProfile.language, language)).get();
  return row ? StyleProfileSchema.parse(row.data) : null;
}

export function saveStyleProfile(db: Db, s: StyleProfile): void {
  const data = StyleProfileSchema.parse(s);
  db.insert(styleProfile)
    .values({ language: data.language, data })
    .onConflictDoUpdate({ target: styleProfile.language, set: { data, updatedAt: new Date().toISOString() } })
    .run();
}

export function addStyleSample(db: Db, language: string, text: string, source: string): number {
  return db.insert(styleSamples).values({ language, text, source }).returning({ id: styleSamples.id }).get().id;
}

export function listStyleSamples(db: Db, language?: string) {
  const q = db.select().from(styleSamples);
  return (language ? q.where(eq(styleSamples.language, language)) : q).orderBy(asc(styleSamples.id)).all();
}

export function deleteStyleSample(db: Db, id: number): void {
  db.delete(styleSamples).where(eq(styleSamples.id, id)).run();
}

export function getSearchProfile(db: Db): { data: SearchProfile; version: number } {
  const row = db.select().from(searchProfile).where(eq(searchProfile.id, 1)).get();
  if (!row) return { data: EMPTY_SEARCH_PROFILE, version: 0 };
  return { data: SearchProfileSchema.parse(row.data), version: row.version };
}

export function saveSearchProfile(db: Db, data: SearchProfile): number {
  const parsed = SearchProfileSchema.parse(data);
  const current = db.select().from(searchProfile).where(eq(searchProfile.id, 1)).get();
  const version = (current?.version ?? 0) + 1;
  db.insert(searchProfile)
    .values({ id: 1, data: parsed, version })
    .onConflictDoUpdate({ target: searchProfile.id, set: { data: parsed, version, updatedAt: new Date().toISOString() } })
    .run();
  return version;
}
