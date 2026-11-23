import { desc, eq } from 'drizzle-orm';
import type { Actor } from '@jobhunter/shared';
import type { Db } from '../client.js';
import { events } from '../schema.js';

export interface NewEvent {
  applicationId?: number | null;
  actor: Actor;
  type: string;
  message: string;
  details?: Record<string, unknown> | null;
  screenshotPath?: string | null;
}

export function addEvent(db: Db, e: NewEvent): number {
  const row = db
    .insert(events)
    .values({
      applicationId: e.applicationId ?? null,
      actor: e.actor,
      type: e.type,
      message: e.message,
      details: e.details ?? null,
      screenshotPath: e.screenshotPath ?? null,
    })
    .returning({ id: events.id })
    .get();
  return row.id;
}

export function listEvents(db: Db, applicationId: number) {
  return db.select().from(events).where(eq(events.applicationId, applicationId)).orderBy(desc(events.id)).all();
}

export function recentEvents(db: Db, limit = 100) {
  return db.select().from(events).orderBy(desc(events.id)).limit(limit).all();
}
