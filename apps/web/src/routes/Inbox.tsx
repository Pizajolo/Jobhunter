import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EmailClass } from '@jobhunter/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { EmailConnect, useEmailStatus } from '../features/email/EmailConnect';

interface InboxEmail {
  id: number;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  classification: EmailClass | null;
  keySentence: string | null;
  applicationId: number | null;
  applicationCompany: string | null;
  applicationTitle: string | null;
  reviewStatus: string;
}

const KIND: Partial<Record<EmailClass, 'ok' | 'bad' | 'warn' | 'info' | 'muted'>> = {
  rejection: 'bad',
  interview_invite: 'warn',
  offer: 'ok',
  assessment: 'warn',
  application_received: 'info',
};

/** Job-related emails only, grouped by application (spec §5.7.5). */
export default function Inbox() {
  const { t, i18n } = useTranslation();
  const status = useEmailStatus();
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<InboxEmail[]>('/api/inbox') });
  const groups = new Map<string, InboxEmail[]>();
  for (const e of q.data ?? []) {
    const key = e.applicationId ? `${e.applicationId}` : e.classification === 'job_alert' ? 'alerts' : e.classification === 'recruiter_outreach' ? 'recruiters' : 'unlinked';
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  if (status.data?.provider === 'none') {
    return (
      <>
        <PageHeader title={t('pages.inbox')} />
        <Card title={t('onboarding.title.email')}>
          <EmailConnect />
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('pages.inbox')} subtitle={t('inbox.subtitle')} />
      {groups.size === 0 ? <EmptyState title={t('inbox.empty')} /> : null}
      {[...groups.entries()].map(([key, list]) => {
        const first = list[0]!;
        const title =
          key === 'alerts' ? t('inbox.alerts') : key === 'recruiters' ? t('inbox.recruiters') : key === 'unlinked' ? t('inbox.unlinked') : `${first.applicationCompany} — ${first.applicationTitle}`;
        return (
          <Card key={key} title={first.applicationId ? <Link to={`/jobs/${first.applicationId}`}>{title}</Link> : title}>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {list.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 border-t border-line pt-2.5 text-[13.5px] first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.subject}</span>
                    {e.classification ? <Badge kind={KIND[e.classification] ?? 'muted'}>{t(`email.class.${e.classification}`)}</Badge> : null}
                    {e.reviewStatus === 'pending' ? <Badge kind="warn">{t('nav.review')}</Badge> : null}
                  </div>
                  <span className="text-[12.5px] text-ink-3">
                    {e.fromAddress} · {formatDateTime(e.receivedAt, i18n.language)}
                  </span>
                  <span className="text-ink-2">{e.keySentence ? `“${e.keySentence}”` : e.snippet}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
