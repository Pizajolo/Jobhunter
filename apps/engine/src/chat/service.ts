import {
  applications,
  asc,
  chatMessages,
  companies,
  desc,
  eq,
  getSearchProfile,
  getSettings,
  jobs,
  matches,
  saveSearchProfile,
  sources,
  updateSettings,
} from '@jobhunter/db';
import { diffValues, type DiffEntry, type SearchProfile } from '@jobhunter/shared';
import type { AppContext } from '../context.js';
import { runTask } from '../agent/runner.js';
import { chatTask, searchProfileChatTask, type Proposal } from '../tasks/scan.js';
import { addCompany } from '../scan/companies.js';
import { getProfile } from '@jobhunter/db';
import { profileSummary } from '../profile/facts.js';

export interface StoredProposal {
  kind: Proposal['kind'];
  summary: string;
  diff: DiffEntry[];
  payload: Proposal;
}

/** Compact, factual snapshot of the pipeline for the chat model. */
export function buildContext(ctx: AppContext): string {
  const s = getSettings(ctx.db);
  const apps = ctx.db
    .select({
      id: applications.id,
      status: applications.status,
      appliedAt: applications.appliedAt,
      statusChangedAt: applications.statusChangedAt,
      lastEmailAt: applications.lastEmailAt,
      company: jobs.company,
      title: jobs.title,
      location: jobs.location,
      score: matches.score,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(matches, eq(matches.jobId, jobs.id))
    .orderBy(desc(applications.updatedAt))
    .limit(150)
    .all();
  const comps = ctx.db.select({ name: companies.name, status: companies.watchStatus }).from(companies).all();
  const srcCount = ctx.db.select({ id: sources.id }).from(sources).all().length;
  const lines = [
    `Applications (most recent first, ${apps.length} shown):`,
    ...apps.map(
      (a) =>
        `- #${a.id} ${a.company} — ${a.title} (${a.location}) · status ${a.status} since ${a.statusChangedAt.slice(0, 10)}` +
        `${a.appliedAt ? ` · applied ${a.appliedAt.slice(0, 10)}` : ''}${a.lastEmailAt ? ` · last email ${a.lastEmailAt.slice(0, 10)}` : ''}${a.score !== null ? ` · match ${a.score}%` : ''}`,
    ),
    `Watched companies: ${comps.filter((c) => c.status === 'watching').map((c) => c.name).join(', ') || 'none'}`,
    `Sources configured: ${srcCount}`,
    `Settings: scan at ${s.scan.time}; show matches ≥ ${s.matchThresholdShow}%; no-response after ${s.noResponseAfterDays} days; auto-apply level ${s.autoApply.level}; application language ${s.applicationLanguage}; discovery ${s.discovery.enabled ? 'on' : 'off'}.`,
    `Candidate profile:\n${profileSummary(getProfile(ctx.db).data) || '(empty)'}`,
  ];
  return lines.join('\n').slice(0, 20_000);
}

function proposalDiff(ctx: AppContext, p: Proposal): DiffEntry[] {
  switch (p.kind) {
    case 'none':
      return [];
    case 'search_profile':
      return diffValues(getSearchProfile(ctx.db).data, p.searchProfile).map((d) => ({ ...d, path: `search.${d.path}` }));
    case 'add_companies':
      return p.companies.map((c) => ({ path: 'companies', op: 'add' as const, after: c.careersUrl ? `${c.name} (${c.careersUrl})` : c.name }));
    case 'settings': {
      const s = getSettings(ctx.db);
      const out: DiffEntry[] = [];
      const c = p.changes;
      if (c.scanTime && c.scanTime !== s.scan.time) out.push({ path: 'scan.time', op: 'change', before: s.scan.time, after: c.scanTime });
      if (c.matchThresholdShow !== null && c.matchThresholdShow !== s.matchThresholdShow) out.push({ path: 'matchThresholdShow', op: 'change', before: s.matchThresholdShow, after: c.matchThresholdShow });
      if (c.noResponseAfterDays !== null && c.noResponseAfterDays !== s.noResponseAfterDays) out.push({ path: 'noResponseAfterDays', op: 'change', before: s.noResponseAfterDays, after: c.noResponseAfterDays });
      if (c.discoveryEnabled !== null && c.discoveryEnabled !== s.discovery.enabled) out.push({ path: 'discovery.enabled', op: 'change', before: s.discovery.enabled, after: c.discoveryEnabled });
      if (c.applicationLanguage && c.applicationLanguage !== s.applicationLanguage) out.push({ path: 'applicationLanguage', op: 'change', before: s.applicationLanguage, after: c.applicationLanguage });
      return out;
    }
  }
}

export function listMessages(ctx: AppContext, thread: string) {
  return ctx.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.thread, thread))
    .orderBy(asc(chatMessages.id))
    .all()
    .map((m) => {
      const p = m.proposal as StoredProposal | null;
      return { ...m, proposal: p ? { kind: p.kind, summary: p.summary, diff: p.diff } : null };
    });
}

export async function sendMessage(ctx: AppContext, thread: string, content: string) {
  const history = listMessages(ctx, thread)
    .slice(-12)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  ctx.db.insert(chatMessages).values({ thread, role: 'user', content }).run();
  ctx.bus.invalidate('chat');
  const task = thread === 'search' ? searchProfileChatTask : chatTask;
  const r = await runTask(ctx, task, {
    message: content,
    history,
    context: buildContext(ctx),
    searchProfile: getSearchProfile(ctx.db).data,
    today: new Date().toISOString().slice(0, 10),
  });
  if (!r.ok) {
    ctx.db.insert(chatMessages).values({ thread, role: 'assistant', content: `Sorry, that failed: ${r.error.message}` }).run();
  } else {
    const p = r.output.proposal;
    const diff = proposalDiff(ctx, p);
    const stored: StoredProposal | null = p.kind === 'none' || diff.length === 0 ? null : { kind: p.kind, summary: p.summary, diff, payload: p };
    ctx.db
      .insert(chatMessages)
      .values({ thread, role: 'assistant', content: r.output.reply, proposal: stored, proposalStatus: stored ? 'pending' : null })
      .run();
  }
  ctx.bus.invalidate('chat');
  return listMessages(ctx, thread);
}

/** Apply a confirmed proposal (the user clicked "Apply change"). */
export async function applyProposal(ctx: AppContext, messageId: number): Promise<void> {
  const m = ctx.db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).get();
  if (!m || m.proposalStatus !== 'pending' || !m.proposal) throw new Error('No pending change on this message');
  const p = (m.proposal as StoredProposal).payload;
  switch (p.kind) {
    case 'search_profile':
      saveSearchProfile(ctx.db, p.searchProfile as SearchProfile);
      ctx.bus.invalidate('search-profile', 'board');
      break;
    case 'add_companies':
      for (const c of p.companies) await addCompany(ctx, { name: c.name, careersUrl: c.careersUrl ?? undefined });
      break;
    case 'settings': {
      const c = p.changes;
      updateSettings(ctx.db, {
        ...(c.scanTime ? { scan: { time: c.scanTime } } : {}),
        ...(c.matchThresholdShow !== null ? { matchThresholdShow: c.matchThresholdShow } : {}),
        ...(c.noResponseAfterDays !== null ? { noResponseAfterDays: c.noResponseAfterDays } : {}),
        ...(c.discoveryEnabled !== null ? { discovery: { enabled: c.discoveryEnabled } } : {}),
        ...(c.applicationLanguage ? { applicationLanguage: c.applicationLanguage } : {}),
      });
      ctx.bus.invalidate('settings');
      break;
    }
    case 'none':
      break;
  }
  ctx.db.update(chatMessages).set({ proposalStatus: 'applied' }).where(eq(chatMessages.id, messageId)).run();
  ctx.bus.invalidate('chat');
}

export function rejectProposal(ctx: AppContext, messageId: number): void {
  ctx.db.update(chatMessages).set({ proposalStatus: 'rejected' }).where(eq(chatMessages.id, messageId)).run();
  ctx.bus.invalidate('chat');
}
