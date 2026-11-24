import { eq } from 'drizzle-orm';
import { canTransition, type Actor, type ApplicationStatus } from '@jobhunter/shared';
import type { Db } from '../client.js';
import { applications, events } from '../schema.js';

export class TransitionError extends Error {}

/**
 * The only way to change an application's status. Enforces the status machine and writes a
 * timeline event, so every change is auditable (spec §4 events).
 */
export function setApplicationStatus(
  db: Db,
  id: number,
  to: ApplicationStatus,
  actor: Actor,
  message: string,
  details?: Record<string, unknown>,
): { changed: boolean; from: ApplicationStatus } {
  return db.transaction((tx) => {
    const app = tx.select().from(applications).where(eq(applications.id, id)).get();
    if (!app) throw new TransitionError(`Application ${id} not found`);
    const from = app.status as ApplicationStatus;
    if (from === to && !(actor === 'email' && to === 'interview')) return { changed: false, from };
    if (!canTransition(from, to, actor)) throw new TransitionError(`${actor} may not move an application from ${from} to ${to}`);
    const now = new Date().toISOString();
    tx.update(applications)
      .set({
        status: to,
        statusChangedAt: now,
        updatedAt: now,
        ...(to === 'applied' && !app.appliedAt ? { appliedAt: now } : {}),
      })
      .where(eq(applications.id, id))
      .run();
    tx.insert(events)
      .values({ applicationId: id, actor, type: 'status_changed', message, details: { from, to, ...details } })
      .run();
    return { changed: from !== to, from };
  });
}
