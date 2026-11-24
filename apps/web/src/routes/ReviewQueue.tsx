import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EMAIL_CLASSES, type EmailClass } from '@jobhunter/shared';
import { api, queryClient } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Select } from '../components/ui';

interface ReviewEmail {
  id: number;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  classification: EmailClass | null;
  confidence: number | null;
  keySentence: string | null;
  applicationId: number | null;
  suggestion: { id: number; company: string; title: string } | null;
}
interface ReviewResponse {
  emails: ReviewEmail[];
  applications: { id: number; company: string; title: string; status: string }[];
}

const STATUS_CLASSES: EmailClass[] = ['application_received', 'rejection', 'interview_invite', 'assessment', 'offer'];

function ReviewItem({ e, apps }: { e: ReviewEmail; apps: ReviewResponse['applications'] }) {
  const { t, i18n } = useTranslation();
  const [appId, setAppId] = useState<number | ''>(e.applicationId ?? '');
  const [cls, setCls] = useState<EmailClass>(e.classification && STATUS_CLASSES.includes(e.classification) ? e.classification : 'application_received');
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
  };
  const assign = useMutation({ mutationFn: () => api.post(`/api/review/${e.id}`, { action: 'assign', applicationId: appId, classification: cls }), onSuccess: done });
  const ignore = useMutation({ mutationFn: () => api.post(`/api/review/${e.id}`, { action: 'ignore' }), onSuccess: done });
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{e.subject}</span>
        {e.classification ? (
          <Badge kind="warn">
            {t(`email.class.${e.classification}`)}
            {e.confidence !== null ? ` · ${Math.round(e.confidence * 100)}%` : ''}
          </Badge>
        ) : null}
      </div>
      <span className="text-[12.5px] text-ink-3">
        {e.fromAddress} · {formatDateTime(e.receivedAt, i18n.language)}
      </span>
      <p className="m-0 text-ink-2">{e.keySentence ? `“${e.keySentence}”` : e.snippet}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-3">
          {t('review.application')}
          <Select value={appId} onChange={(ev) => setAppId(ev.target.value ? Number(ev.target.value) : '')} className="min-w-64">
            <option value="">{t('review.choose')}</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.company} — {a.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-3">
          {t('review.meaning')}
          <Select value={cls} onChange={(ev) => setCls(ev.target.value as EmailClass)}>
            {EMAIL_CLASSES.filter((c) => STATUS_CLASSES.includes(c)).map((c) => (
              <option key={c} value={c}>
                {t(`email.class.${c}`)}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="primary" busy={assign.isPending} disabled={appId === ''} onClick={() => assign.mutate()}>
          {t('review.assign')}
        </Button>
        <Button busy={ignore.isPending} onClick={() => ignore.mutate()}>
          {t('review.ignore')}
        </Button>
      </div>
      <ErrorText error={assign.error ?? ignore.error} />
    </li>
  );
}

/** Emails the app couldn't confidently match; one-click assign or ignore (spec §5.7.4). */
export default function ReviewQueue() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['review'], queryFn: () => api.get<ReviewResponse>('/api/review') });
  return (
    <>
      <PageHeader title={t('pages.review_queue')} subtitle={t('review.subtitle')} />
      <Card>
        {q.data?.emails.length ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {q.data.emails.map((e) => (
              <ReviewItem key={e.id} e={e} apps={q.data.applications} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('review.empty')} />
        )}
      </Card>
    </>
  );
}
