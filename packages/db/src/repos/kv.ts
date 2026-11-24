import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { kv } from '../schema.js';

export function kvGet(db: Db, key: string): string | null {
  return db.select().from(kv).where(eq(kv.key, key)).get()?.value ?? null;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date().toISOString() } }).run();
}

export function kvDelete(db: Db, key: string): void {
  db.delete(kv).where(eq(kv.key, key)).run();
}
