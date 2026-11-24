import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, PageHeader, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatUsd } from '../lib/format';

interface GroupRow {
  key: string;
  applied: number;
  replied: number;
  interviews: number;
  offers: number;
}

interface Stats {
  funnel: { found: number; shortlisted: number; applied: number; replied: number; interviews: number; offers: number };
  medianDaysToFirstReply: number | null;
  repliesMeasured: number;
  bySource: GroupRow[];
  byRole: GroupRow[];
  costByTask: { task: string; runs: number; failed: number; costUsd: number }[];
  costByMonth: { month: string; costUsd: number }[];
  totalCostUsd: number;
}

const PERIODS = ['30', '90', '365', 'all'] as const;
/** Product names of the job boards and ATS adapters (not translated). */
const SOURCE_NAMES: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  recruitee: 'Recruitee',
  personio: 'Personio',
  workday: 'Workday',
  arbeitnow: 'Arbeitnow',
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Thin single-hue bar for a value from 0 to max, with the number as text beside it. */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2.5 min-w-6 flex-1 rounded-full bg-sunken" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
      </div>
      <span className="w-11 shrink-0 text-right text-[12.5px] tabular-nums text-ink-2 sm:w-14">{label}</span>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </div>
  );
}

function RateTable({ rows, keyLabel, keyName }: { rows: GroupRow[]; keyLabel: string; keyName: (k: string) => string }) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="m-0 text-[13px] text-ink-3">{t('stats.noApplications')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-2">
            <th className="py-1.5 pr-3 font-medium">{keyLabel}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{t('stats.applied')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('stats.replyRate')}</th>
            <th className="py-1.5 font-medium">{t('stats.interviewRate')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-2 pr-3">{keyName(r.key)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.applied}</td>
              <td className="py-2 pr-3">
                <Bar value={pct(r.replied, r.applied)} max={100} label={`${pct(r.replied, r.applied)}%`} />
              </td>
              <td className="py-2">
                <Bar value={pct(r.interviews, r.applied)} max={100} label={`${pct(r.interviews, r.applied)}%`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Statistics (spec §5.9): funnel, reply and interview rates by source and role, time to first reply, model cost. */
export default function Stats() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('90');
  const q = useQuery({ queryKey: ['stats', period], queryFn: () => api.get<Stats>(`/api/stats${period === 'all' ? '' : `?days=${period}`}`) });
  const s = q.data;
  const funnelSteps = s
    ? ([
        ['found', s.funnel.found],
        ['shortlisted', s.funnel.shortlisted],
        ['applied', s.funnel.applied],
        ['replied', s.funnel.replied],
        ['interviews', s.funnel.interviews],
        ['offers', s.funnel.offers],
      ] as const)
    : [];
  const maxCost = Math.max(0, ...(s?.costByTask.map((c) => c.costUsd) ?? []));
  return (
    <>
      <PageHeader
        title={t('pages.stats')}
        actions={
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            {t('stats.period')}
            <Select value={period} onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])} className="w-auto">
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`stats.periods.${p}`)}
                </option>
              ))}
            </Select>
          </label>
        }
      />
      {!s ? (
        <Spinner />
      ) : s.funnel.found === 0 && s.costByTask.length === 0 ? (
        <EmptyState title={t('stats.emptyTitle')}>{t('stats.emptyBody')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('stats.applied')} value={String(s.funnel.applied)} hint={t('stats.ofFound', { count: s.funnel.found })} />
            <Tile label={t('stats.replyRate')} value={`${pct(s.funnel.replied, s.funnel.applied)}%`} hint={t('stats.replies', { count: s.funnel.replied })} />
            <Tile label={t('stats.interviewRate')} value={`${pct(s.funnel.interviews, s.funnel.applied)}%`} hint={t('stats.interviews', { count: s.funnel.interviews })} />
            <Tile
              label={t('stats.timeToReply')}
              value={s.medianDaysToFirstReply === null ? '–' : t('stats.days', { count: s.medianDaysToFirstReply })}
              hint={s.repliesMeasured ? t('stats.measuredOn', { count: s.repliesMeasured }) : t('stats.noReplies')}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('stats.funnel')}>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {funnelSteps.map(([k, v]) => (
                  <li key={k} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-[13.5px]">
                    <span>{t(`stats.steps.${k}`)}</span>
                    <Bar value={v} max={s.funnel.found} label={String(v)} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('stats.cost')} actions={<span className="text-[13px] text-ink-2">{t('stats.total', { amount: formatUsd(s.totalCostUsd) })}</span>}>
              {s.costByTask.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13.5px]">
                    <thead>
                      <tr className="text-left text-[12px] text-ink-2">
                        <th className="py-1.5 pr-3 font-medium">{t('stats.task')}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t('stats.runs')}</th>
                        <th className="py-1.5 font-medium">{t('stats.costCol')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.costByTask.map((c) => (
                        <tr key={c.task} className="border-t border-line">
                          <td className="py-2 pr-3">{t(`tasks.${c.task}`, { defaultValue: c.task })}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {c.runs}
                            {c.failed ? <span className="text-ink-3"> ({t('stats.failed', { count: c.failed })})</span> : null}
                          </td>
                          <td className="py-2">
                            <Bar value={c.costUsd} max={maxCost} label={formatUsd(c.costUsd)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="m-0 text-[13px] text-ink-3">{t('stats.noRuns')}</p>
              )}
              {s.costByMonth.length > 1 ? (
                <p className="m-0 text-[12.5px] text-ink-2">
                  {s.costByMonth.map((m) => `${m.month}: ${formatUsd(m.costUsd)}`).join(' · ')}
                </p>
              ) : null}
              <p className="m-0 text-[12px] text-ink-3">{t('stats.costNote')}</p>
            </Card>
          </div>
          <Card title={t('stats.bySource')}>
            <RateTable rows={s.bySource} keyLabel={t('stats.source')} keyName={(k) => SOURCE_NAMES[k] ?? t(`stats.sources.${k}`, { defaultValue: k })} />
          </Card>
          <Card title={t('stats.byRole')}>
            <RateTable rows={s.byRole} keyLabel={t('stats.role')} keyName={(k) => (k === 'other' ? t('stats.otherRole') : k)} />
          </Card>
        </div>
      )}
    </>
  );
}
