import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TaskRunSummary } from '@jobhunter/shared';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime, formatUsd } from '../lib/format';

interface SourceHealth {
  id: number;
  name: string;
  kind: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastJobCount: number | null;
}

interface DiagnosticsResponse {
  sources: SourceHealth[];
  lastScan: { status: string; startedAt: string; finishedAt: string | null; jobsNew: number; sourcesFailed: number } | null;
  version: string;
  mode: string;
  dataDir: string;
}

export default function Diagnostics() {
  const { t, i18n } = useTranslation();
  const runs = useQuery({ queryKey: ['task-runs'], queryFn: () => api.get<TaskRunSummary[]>('/api/task-runs?limit=200') });
  const diag = useQuery({ queryKey: ['diagnostics'], queryFn: () => api.get<DiagnosticsResponse>('/api/diagnostics') });
  const failed = runs.data?.filter((r) => r.status === 'failed') ?? [];
  return (
    <>
      <PageHeader
        title={t('pages.diagnostics')}
        subtitle={diag.data ? `v${diag.data.version} · ${diag.data.mode} · ${diag.data.dataDir}` : undefined}
        actions={
          <a className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink no-underline" href="/api/diagnostics/logs" download>
            {t('diagnostics.downloadLogs')}
          </a>
        }
      />
      <Card title={t('diagnostics.lastScan')}>
        {diag.data?.lastScan ? (
          <p className="m-0 text-sm">
            {formatDateTime(diag.data.lastScan.startedAt, i18n.language)} · <Badge kind={diag.data.lastScan.status === 'succeeded' ? 'ok' : 'warn'}>{diag.data.lastScan.status}</Badge> ·{' '}
            {t('diagnostics.newJobs', { count: diag.data.lastScan.jobsNew })} · {t('diagnostics.failedSources', { count: diag.data.lastScan.sourcesFailed })}
          </p>
        ) : (
          <p className="m-0 text-sm text-ink-3">{t('diagnostics.noScan')}</p>
        )}
      </Card>
      <Card title={t('diagnostics.sources')}>
        {diag.data?.sources.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="text-ink-3">
                  <th className="py-1.5 pr-3 font-medium">{t('diagnostics.source')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('diagnostics.lastSuccess')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('diagnostics.jobs')}</th>
                  <th className="py-1.5 font-medium">{t('diagnostics.lastError')}</th>
                </tr>
              </thead>
              <tbody>
                {diag.data.sources.map((src) => (
                  <tr key={src.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3">
                      {src.name} <span className="text-ink-3">({src.kind})</span>
                    </td>
                    <td className="py-1.5 pr-3">{src.lastSuccessAt ? formatDateTime(src.lastSuccessAt, i18n.language) : '—'}</td>
                    <td className="py-1.5 pr-3">{src.lastJobCount ?? '—'}</td>
                    <td className="py-1.5 text-bad-ink">{src.lastErrorAt && (!src.lastSuccessAt || src.lastErrorAt > src.lastSuccessAt) ? src.lastError : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-3">{t('diagnostics.noSources')}</p>
        )}
      </Card>
      <Card title={t('diagnostics.failedTasks', { count: failed.length })}>
        {failed.length === 0 ? (
          <EmptyState title={t('diagnostics.noFailures')} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
            {failed.slice(0, 50).map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-2.5">
                <span className="font-semibold">{t(`tasks.${r.task}`)}</span> · {formatDateTime(r.startedAt, i18n.language)} · {r.model}
                <p className="m-0 mt-1 text-bad-ink">{r.error}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('diagnostics.recentTasks')}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1.5 pr-3 font-medium">{t('diagnostics.task')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('diagnostics.status')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('nav.model')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('diagnostics.cost')}</th>
                <th className="py-1.5 font-medium">{t('diagnostics.when')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.data?.slice(0, 100).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1.5 pr-3">{t(`tasks.${r.task}`)}</td>
                  <td className="py-1.5 pr-3">
                    <Badge kind={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : 'muted'}>{r.status}</Badge>
                  </td>
                  <td className="py-1.5 pr-3">{r.model}</td>
                  <td className="py-1.5 pr-3">{formatUsd(r.costUsd)}</td>
                  <td className="py-1.5">{formatDateTime(r.startedAt, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
