import type { FastifyInstance } from 'fastify';
import { applications, applyRuns, documents, emails, getSettings, isNull, notifications, scanRuns, desc, eq, sql } from '@jobhunter/db';
import { modelForTask } from '@jobhunter/shared';
import type { AppContext } from '../../context.js';

export function registerSummaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/summary', async () => {
    const settings = getSettings(ctx.db);
    // Same rule as the Approvals page: ready applications whose package isn't fully approved, plus prepared forms.
    const readyIds = ctx.db.select({ id: applications.id }).from(applications).where(eq(applications.status, 'ready')).all().map((r) => r.id);
    const unapproved = readyIds.filter((id) => {
      const docs = ctx.db.select().from(documents).where(eq(documents.applicationId, id)).all();
      const latest = (type: string) => docs.filter((d) => d.type === type).sort((a, b) => b.version - a.version)[0];
      return !latest('cv')?.approvedAt || !latest('cover_letter')?.approvedAt;
    }).length;
    const prepared = ctx.db.select({ n: sql<number>`count(*)` }).from(applyRuns).where(eq(applyRuns.status, 'prepared')).get()?.n ?? 0;
    const approvals = unapproved + prepared;
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
