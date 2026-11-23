import type { FastifyInstance } from 'fastify';
import { applications, documents, emails, getSettings, isNull, notifications, scanRuns, desc, eq, and, sql } from '@jobhunter/db';
import { modelForTask } from '@jobhunter/shared';
import type { AppContext } from '../../context.js';

export function registerSummaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/summary', async () => {
    const settings = getSettings(ctx.db);
    const approvals = ctx.db
      .select({ n: sql<number>`count(distinct ${documents.applicationId})` })
      .from(documents)
      .innerJoin(applications, eq(applications.id, documents.applicationId))
      .where(and(isNull(documents.approvedAt), eq(applications.status, 'ready')))
      .get()?.n ?? 0;
    const reviewQueue =
      ctx.db.select({ n: sql<number>`count(*)` }).from(emails).where(eq(emails.reviewStatus, 'pending')).get()?.n ?? 0;
    const unread =
      ctx.db.select({ n: sql<number>`count(*)` }).from(notifications).where(isNull(notifications.readAt)).get()?.n ?? 0;
    const lastScan = ctx.db.select().from(scanRuns).orderBy(desc(scanRuns.id)).limit(1).get();
    return {
      approvals,
      reviewQueue,
      model: modelForTask(settings, 'chat'),
      claudeConnected: ctx.runtime.claude?.connected ?? false,
      emailProvider: settings.email.provider,
      emailConnected: ctx.runtime.emailConnected,
      nextScanAt: ctx.runtime.nextScanAt,
      lastScanAt: lastScan?.finishedAt ?? lastScan?.startedAt ?? null,
      unreadNotifications: unread,
      mode: ctx.config.mode,
    };
  });
}
