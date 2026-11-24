import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';

interface ApprovalsResponse {
  packages: { applicationId: number; company: string; title: string; warnings: string[]; updatedAt: string }[];
  preparedForms: { runId: number; applicationId: number; company: string; title: string; screenshotUrl: string | null; stopReason: string | null; createdAt: string }[];
}

/** Packages and prefilled forms waiting for the user (spec §5.7.3). */
export default function Approvals() {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<ApprovalsResponse>('/api/approvals') });
  const d = q.data;
  return (
    <>
      <PageHeader title={t('pages.approvals')} subtitle={t('approvals.subtitle')} />
      <Card title={t('approvals.packages', { count: d?.packages.length ?? 0 })}>
        {d?.packages.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {d.packages.map((p) => (
              <li key={p.applicationId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5 text-sm">
                <span className="flex flex-col">
                  <Link to={`/jobs/${p.applicationId}`} className="font-semibold">
                    {p.title}
                  </Link>
                  <span className="text-[12.5px] text-ink-3">
                    {p.company} · {formatDateTime(p.updatedAt, i18n.language)}
                  </span>
                </span>
                {p.warnings.length ? <Badge kind="warn">{t('approvals.gaps', { count: p.warnings.length })}</Badge> : <Badge kind="info">{t('approvals.review')}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('approvals.noPackages')} />
        )}
      </Card>
      <Card title={t('approvals.forms', { count: d?.preparedForms.length ?? 0 })}>
        {d?.preparedForms.length ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {d.preparedForms.map((f) => (
              <li key={f.runId} className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/jobs/${f.applicationId}`} className="font-semibold">
                    {f.title} · {f.company}
                  </Link>
                  <Badge kind="warn">{f.stopReason ? t(`apply.stop.${f.stopReason}`, { defaultValue: f.stopReason }) : t('approvals.readyToSubmit')}</Badge>
                </div>
                {f.screenshotUrl ? <img src={f.screenshotUrl} alt={t('approvals.screenshotAlt', { company: f.company })} className="max-h-72 w-full rounded border border-line object-contain object-top" /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('approvals.noForms')} />
        )}
      </Card>
    </>
  );
}
