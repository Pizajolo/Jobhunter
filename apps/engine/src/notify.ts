import { desc, isNull, notifications } from '@jobhunter/db';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';

export interface NewNotification {
  kind: 'scan_summary' | 'drafts_ready' | 'interview' | 'rejection' | 'budget' | 'handover' | 'digest' | 'offer' | 'error';
  title: string;
  body: string;
  link?: string | null;
  urgent?: boolean;
}

/**
 * Store a notification and announce it. The desktop shell shows urgent ones immediately; server mode
 * forwards them via web push. Rejections are collected into the daily digest instead (spec §5.8).
 */
export function notify(ctx: AppContext, n: NewNotification): number {
  const row = ctx.db
    .insert(notifications)
    .values({ kind: n.kind, title: n.title, body: n.body, link: n.link ?? null, urgent: n.urgent ?? false })
    .returning({ id: notifications.id })
    .get();
  ctx.bus.emit('notification', { id: row.id, ...n });
  ctx.bus.invalidate('notifications', 'summary');
  return row.id;
}

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/notifications', async () =>
    ctx.db.select().from(notifications).orderBy(desc(notifications.id)).limit(100).all(),
  );
  app.post('/api/notifications/read', async () => {
    ctx.db
      .update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(isNull(notifications.readAt))
      .run();
    ctx.bus.invalidate('notifications', 'summary');
    return { ok: true };
  });
}
