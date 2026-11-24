import { eq, schedulerState } from '@jobhunter/db';
import type { AppContext } from './context.js';
import { registerService } from './services.js';

/**
 * Wall-clock schedule. "daily" runs at HH:MM local time, "weekly" on a weekday at HH:MM,
 * "every" at a fixed interval.
 */
export type Schedule =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }
  | { kind: 'every'; minutes: number }
  | { kind: 'off' };

export interface ScheduledJob {
  name: string;
  schedule(ctx: AppContext): Schedule;
  run(ctx: AppContext, trigger: 'schedule' | 'catchup'): Promise<unknown>;
}

const jobs: ScheduledJob[] = [];
const runningJobs = new Set<string>();

export function registerJob(job: ScheduledJob): void {
  if (!jobs.some((j) => j.name === job.name)) jobs.push(job);
}

function at(base: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** Most recent moment the job should have run, at or before `now`. */
export function lastScheduled(s: Schedule, now: Date, lastRun: Date | null): Date | null {
  switch (s.kind) {
    case 'off':
      return null;
    case 'every':
      return lastRun ? new Date(lastRun.getTime() + s.minutes * 60_000) : now;
    case 'daily': {
      const today = at(now, s.time);
      return today <= now ? today : new Date(today.getTime() - 86_400_000);
    }
    case 'weekly': {
      const d = at(now, s.time);
      const diff = (d.getDay() - s.weekday + 7) % 7;
      d.setDate(d.getDate() - diff);
      return d <= now ? d : new Date(d.getTime() - 7 * 86_400_000);
    }
  }
}

export function nextScheduled(s: Schedule, now: Date, lastRun: Date | null): Date | null {
  switch (s.kind) {
    case 'off':
      return null;
    case 'every':
      return lastRun ? new Date(lastRun.getTime() + s.minutes * 60_000) : now;
    case 'daily': {
      const today = at(now, s.time);
      return today > now ? today : new Date(today.getTime() + 86_400_000);
    }
    case 'weekly': {
      const last = lastScheduled(s, now, lastRun)!;
      return new Date(last.getTime() + 7 * 86_400_000);
    }
  }
}

function lastRunOf(ctx: AppContext, name: string): Date | null {
  const row = ctx.db.select().from(schedulerState).where(eq(schedulerState.job, name)).get();
  return row?.lastRunAt ? new Date(row.lastRunAt) : null;
}

/**
 * Checks every minute whether a run is due. Because it compares against the last scheduled time
 * (not a timer), runs missed while the laptop slept are caught up right after wake (spec §3.5).
 */
export async function tick(ctx: AppContext, now = new Date()): Promise<string[]> {
  const started: string[] = [];
  for (const job of jobs) {
    if (runningJobs.has(job.name)) continue;
    const s = job.schedule(ctx);
    const last = lastRunOf(ctx, job.name);
    const due = lastScheduled(s, now, last);
    if (!due || due > now) continue;
    if (last && last >= due) continue;
    // first run ever for daily/weekly jobs: don't fire for a time in the past on a fresh install
    if (!last && s.kind !== 'every') {
      markRun(ctx, job.name, now, 'skipped-initial');
      continue;
    }
    const trigger = last && now.getTime() - due.getTime() > 5 * 60_000 ? 'catchup' : 'schedule';
    runningJobs.add(job.name);
    started.push(job.name);
    markRun(ctx, job.name, now, 'running');
    void job
      .run(ctx, trigger)
      .then(() => markRun(ctx, job.name, now, 'ok'))
      .catch((err: unknown) => {
        ctx.log.error({ err, job: job.name }, 'scheduled job failed');
        markRun(ctx, job.name, now, 'failed');
      })
      .finally(() => {
        runningJobs.delete(job.name);
        updateNextScan(ctx);
      });
  }
  updateNextScan(ctx);
  return started;
}

function markRun(ctx: AppContext, name: string, at: Date, status: string) {
  ctx.db
    .insert(schedulerState)
    .values({ job: name, lastRunAt: at.toISOString(), lastStatus: status })
    .onConflictDoUpdate({ target: schedulerState.job, set: { lastRunAt: at.toISOString(), lastStatus: status } })
    .run();
}

export function updateNextScan(ctx: AppContext): void {
  const scan = jobs.find((j) => j.name === 'scan');
  if (!scan) return;
  const next = nextScheduled(scan.schedule(ctx), new Date(), lastRunOf(ctx, 'scan'));
  const iso = next?.toISOString() ?? null;
  if (iso !== ctx.runtime.nextScanAt) {
    ctx.runtime.nextScanAt = iso;
    ctx.bus.invalidate('summary');
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

registerService({
  name: 'scheduler',
  start(ctx) {
    if (process.env.JOBHUNTER_DISABLE_SCHEDULER === '1') return;
    void tick(ctx);
    timer = setInterval(() => void tick(ctx), 60_000);
    timer.unref();
    // The desktop shell forwards OS resume events; check right away after wake.
    ctx.bus.on('system:resume', () => void tick(ctx));
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
});
