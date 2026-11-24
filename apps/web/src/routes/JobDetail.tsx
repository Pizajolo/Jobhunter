import clsx from 'clsx';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { APPLICATION_STATUSES, type CoverLetter, type FormAnswer, type TailoredCv } from '@jobhunter/shared';
import { api, queryClient } from '../lib/api';
import { daysSince, formatDate, formatDateTime } from '../lib/format';
import { Badge, Button, Card, ErrorText, Input, PageHeader, Select, Spinner, Tabs, Textarea } from '../components/ui';
import { AnswersEditor, AnswersView, CvEditor, LetterEditor, LetterView } from '../features/documents/editors';

interface DocView<T> {
  id: number;
  type: string;
  language: string;
  content: T;
  factsUsed: string[];
  warnings: string[];
  version: number;
  approvedAt: string | null;
  model: string | null;
  pdfUrl: string | null;
}

interface Detail {
  application: { id: number; status: string; appliedAt: string | null; notes: string; senderDomains: string[]; atsRefIds: string[]; autoSubmitted: boolean };
  job: { id: number; company: string; title: string; location: string; remote: string; url: string; applyUrl: string | null; atsType: string; atsJobId: string | null; firstSeenAt: string; description: string; closedAt: string | null };
  match: { score: number; reasons: string[]; gaps: string[]; prefilterPassed: boolean; prefilterReason: string | null } | null;
  drafting: boolean;
  documents: { cv: DocView<TailoredCv> | null; cover_letter: DocView<CoverLetter> | null; form_answers: DocView<FormAnswer[]> | null };
  events: { id: number; actor: string; type: string; message: string; createdAt: string; screenshotPath: string | null }[];
  emails: { id: number; fromAddress: string; subject: string; receivedAt: string; classification: string | null; keySentence: string | null }[];
  applyRuns: { id: number; status: string; stopReason: string | null; createdAt: string; screenshotPath: string | null }[];
}

type DocTab = 'cv' | 'cover_letter' | 'form_answers';
const STEPS = ['found', 'shortlisted', 'ready', 'applied', 'interview', 'offer'] as const;
const STEP_OF: Record<string, number> = { found: 0, shortlisted: 1, drafting: 1, ready: 2, applied: 3, interview: 4, assessment: 4, offer: 5 };

function Stepper({ status }: { status: string }) {
  const { t } = useTranslation();
  const cur = STEP_OF[status];
  if (cur === undefined) {
    return (
      <div className="rounded-[10px] border border-line bg-surface px-4 py-3 text-sm">
        <Badge kind="muted">{t(`status.${status}`)}</Badge>
      </div>
    );
  }
  return (
    <ol aria-label={t('detail.status')} className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 rounded-[10px] border border-line bg-surface px-4 py-3 text-[13px]">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === cur ? 'step' : undefined} className={clsx(i === cur ? 'font-semibold text-warn-ink' : i < cur ? 'text-ink-2' : 'text-ink-3')}>
          {i < cur ? '✓ ' : i === cur ? '● ' : ''}
          {t(`detail.steps.${s}`)}
        </li>
      ))}
    </ol>
  );
}

export default function JobDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const key = `application:${id}`;
  const q = useQuery({ queryKey: [key], queryFn: () => api.get<Detail>(`/api/applications/${id}`), refetchInterval: (qq) => (qq.state.data?.drafting || qq.state.data?.applyRuns.some((r) => r.status === 'running') ? 2000 : false) });
  const [tab, setTab] = useState<DocTab>('cv');
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [showRegen, setShowRegen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };
  const generate = useMutation({ mutationFn: (body: { types?: DocTab[]; instruction?: string | null }) => api.post(`/api/applications/${id}/generate`, body), onSuccess: () => setTimeout(refresh, 300) });
  const setStatus = useMutation({ mutationFn: (status: string) => api.patch(`/api/applications/${id}/status`, { status }), onSuccess: refresh });
  const save = useMutation({
    mutationFn: ({ docId, content }: { docId: number; content: unknown }) => api.put(`/api/documents/${docId}`, { content }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const approve = useMutation({ mutationFn: () => api.post(`/api/applications/${id}/approve`), onSuccess: refresh });
  const apply = useMutation({ mutationFn: () => api.post<{ runId: number }>(`/api/applications/${id}/apply`), onSuccess: refresh });
  const markApplied = useMutation({ mutationFn: () => api.post(`/api/applications/${id}/mark-applied`), onSuccess: refresh });
  const saveNotes = useMutation({ mutationFn: (n: string) => api.patch(`/api/applications/${id}/notes`, { notes: n }) });

  if (q.isPending) return <Spinner />;
  if (!q.data) return <ErrorText error={q.error ?? 'Not found'} />;
  const d = q.data;
  const { job, match, application } = d;
  const docs = d.documents;
  const doc = docs[tab];
  const hasPackage = !!docs.cv && !!docs.cover_letter;
  const approved = hasPackage && !!docs.cv?.approvedAt && !!docs.cover_letter?.approvedAt;
  const isClosedPosting = !!job.closedAt;

  const applyMyself = () => {
    const answers = (docs.form_answers?.content ?? []).filter((a) => !a.gap).map((a) => `${a.question}\n${a.answer}`).join('\n\n');
    if (answers) {
      void navigator.clipboard?.writeText(answers);
      setCopied(true);
    }
    window.open(job.applyUrl ?? job.url, '_blank', 'noopener');
  };

  return (
    <>
      <Link to="/" className="self-start text-[13.5px] font-medium no-underline">
        ← {t('detail.back')}
      </Link>
      <PageHeader
        title={job.title}
        subtitle={
          <>
            <span className="font-semibold text-ink-2">
              {job.company} · {job.location}
              {job.remote !== 'unknown' ? ` · ${t(`remote.${job.remote}`)}` : ''}
            </span>
            <br />
            {t('detail.foundOn', { date: formatDate(job.firstSeenAt, i18n.language), source: t(`sources.${job.atsType}`, { defaultValue: job.atsType }) })}
            {isClosedPosting ? ` · ${t('detail.postingClosed')}` : ''}
          </>
        }
        actions={
          <>
            {match ? <Badge kind={match.score >= 75 ? 'info' : 'muted'} className="px-3 py-1.5 text-[13px] font-semibold">{t('detail.match', { score: match.score })}</Badge> : null}
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-[13.5px] font-medium text-ink no-underline">
              {t('detail.openPosting')}
            </a>
            <label htmlFor="status-select" className="sr-only">
              {t('detail.status')}
            </label>
            <Select id="status-select" className="max-w-52" value={application.status} onChange={(e) => setStatus.mutate(e.target.value)}>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <Stepper status={application.status} />
      <ErrorText error={setStatus.error ?? generate.error ?? save.error ?? approve.error ?? apply.error} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {match ? (
            <Card title={t('detail.whyMatches')}>
              {match.prefilterPassed ? (
                <ul className="m-0 flex flex-col gap-1.5 pl-5 text-[13.5px] leading-snug">
                  {match.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                  {match.gaps.map((g) => (
                    <li key={g} className="text-warn-ink">
                      {t('detail.gap', { gap: g })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-ink-3">{match.prefilterReason}</p>
              )}
            </Card>
          ) : null}

          <Card
            title={t('detail.package')}
            actions={
              hasPackage || docs.form_answers ? (
                <Tabs<DocTab>
                  label={t('detail.documents')}
                  value={tab}
                  onChange={(v) => {
                    setTab(v);
                    setEditing(false);
                  }}
                  tabs={[
                    { id: 'cv', label: t('detail.tabs.cv') },
                    { id: 'cover_letter', label: t('detail.tabs.cover_letter') },
                    { id: 'form_answers', label: t('detail.tabs.form_answers', { count: docs.form_answers?.content.length ?? 0 }) },
                  ]}
                />
              ) : null
            }
          >
            {d.drafting ? (
              <p className="m-0 flex items-center gap-2 text-sm text-ink-2" role="status">
                <Spinner small /> {t('detail.drafting')}
              </p>
            ) : null}
            {!hasPackage && !d.drafting ? (
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-sm text-ink-2">{t('detail.noPackage')}</p>
                <Button variant="primary" busy={generate.isPending} onClick={() => generate.mutate({})}>
                  {t('detail.draft')}
                </Button>
              </div>
            ) : null}
            {doc ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <span>{t('detail.version', { v: doc.version, lang: doc.language.toUpperCase() })}</span>
                  {doc.approvedAt ? <Badge kind="ok">{t('detail.approved')}</Badge> : <Badge kind="warn">{t('detail.notApproved')}</Badge>}
                  <span>{t('detail.factsUsed', { count: doc.factsUsed.length })}</span>
                  {doc.pdfUrl ? (
                    <a href={doc.pdfUrl} target="_blank" rel="noreferrer">
                      {t('detail.openPdf')}
                    </a>
                  ) : null}
                </div>
                {doc.warnings.length ? (
                  <ul className="m-0 flex flex-col gap-1 rounded-lg bg-warn-soft px-4 py-2 pl-8 text-[13px] text-warn-ink">
                    {doc.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {editing ? (
                  tab === 'cover_letter' ? (
                    <LetterEditor letter={(doc as DocView<CoverLetter>).content} busy={save.isPending} onCancel={() => setEditing(false)} onSave={(content) => save.mutate({ docId: doc.id, content })} />
                  ) : tab === 'cv' ? (
                    <CvEditor cv={(doc as DocView<TailoredCv>).content} busy={save.isPending} onCancel={() => setEditing(false)} onSave={(content) => save.mutate({ docId: doc.id, content })} />
                  ) : (
                    <AnswersEditor answers={(doc as DocView<FormAnswer[]>).content} busy={save.isPending} onCancel={() => setEditing(false)} onSave={(content) => save.mutate({ docId: doc.id, content })} />
                  )
                ) : tab === 'cover_letter' ? (
                  <LetterView letter={(doc as DocView<CoverLetter>).content} />
                ) : tab === 'cv' && doc.pdfUrl ? (
                  <iframe title={t('detail.tabs.cv')} src={doc.pdfUrl} className="h-[70vh] w-full rounded-[10px] border border-line bg-white" />
                ) : tab === 'form_answers' ? (
                  <AnswersView answers={(doc as DocView<FormAnswer[]>).content} />
                ) : null}
                {tab === 'cover_letter' && !editing ? <p className="m-0 text-[12.5px] text-ink-3">{t('detail.styleNote')}</p> : null}
                {!editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>
                    <Button aria-expanded={showRegen} onClick={() => setShowRegen((v) => !v)}>
                      {t('detail.regenerate')}
                    </Button>
                    <span className="flex-1" />
                    <Button onClick={applyMyself}>{copied ? t('detail.answersCopied') : t('detail.applyMyself')}</Button>
                    {approved ? (
                      <Button variant="primary" busy={apply.isPending} disabled={!['ready', 'shortlisted', 'drafting'].includes(application.status)} onClick={() => apply.mutate()}>
                        {t('detail.applyWithAgent')}
                      </Button>
                    ) : (
                      <Button variant="primary" busy={approve.isPending} disabled={!hasPackage} onClick={() => approve.mutate()}>
                        {t('detail.approve')}
                      </Button>
                    )}
                  </div>
                ) : null}
                {showRegen && !editing ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      generate.mutate({ types: [tab], instruction: instruction || null });
                      setShowRegen(false);
                      setInstruction('');
                    }}
                  >
                    <label htmlFor="regen-instruction" className="sr-only">
                      {t('detail.instruction')}
                    </label>
                    <Input id="regen-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('detail.instruction')} />
                    <Button type="submit" variant="primary" busy={generate.isPending}>
                      {t('detail.regenerate')}
                    </Button>
                  </form>
                ) : null}
                <p className="m-0 text-[12.5px] text-ink-3">{t('detail.applyNote')}</p>
              </div>
            ) : null}
          </Card>

          {d.applyRuns.length ? (
            <Card title={t('apply.runs.title')}>
              {d.applyRuns.slice(0, 3).map((r) => (
                <div key={r.id} className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge kind={r.status === 'submitted' ? 'ok' : r.status === 'running' ? 'info' : 'warn'}>{t(`apply.runs.status.${r.status}`)}</Badge>
                    {r.stopReason ? <span className="text-ink-2">{t(`apply.stop.${r.stopReason}`)}</span> : null}
                    <span className="text-[12.5px] text-ink-3">{formatDateTime(r.createdAt, i18n.language)}</span>
                  </div>
                  {r.screenshotPath ? <img src={`/api/apply-runs/${r.id}/screenshot`} alt={t('apply.runs.screenshot')} className="max-h-80 w-full rounded border border-line object-contain object-top" /> : null}
                  {(r.status === 'prepared' || r.status === 'handover') && application.status !== 'applied' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" busy={markApplied.isPending} onClick={() => markApplied.mutate()}>
                        {t('apply.runs.markApplied')}
                      </Button>
                      <a href={job.applyUrl ?? job.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink no-underline">
                        {t('apply.runs.openForm')}
                      </a>
                    </div>
                  ) : null}
                  {r.status === 'prepared' ? <p className="m-0 text-[12.5px] text-ink-3">{t('apply.runs.preparedHint')}</p> : null}
                </div>
              ))}
            </Card>
          ) : null}

          <Card title={t('detail.posting')}>
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t('detail.showDescription')}</summary>
              <p className="m-0 mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{job.description || t('detail.noDescription')}</p>
            </details>
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <Card title={t('detail.timeline')}>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {d.events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 text-[13px]">
                  <span className="font-medium">{e.message}</span>
                  <span className="text-ink-3">
                    {formatDateTime(e.createdAt, i18n.language)} · {t(`detail.actor.${e.actor}`)}
                  </span>
                  {e.screenshotPath ? (
                    <a href={`/api/events/${e.id}/screenshot`} target="_blank" rel="noreferrer">
                      {t('detail.screenshot')}
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
          <Card title={t('detail.emailTracking')}>
            {d.emails.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {d.emails.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 text-[13px]">
                    <span className="font-medium">{e.subject}</span>
                    <span className="text-ink-3">
                      {formatDate(e.receivedAt, i18n.language)} · {e.fromAddress} {e.classification ? `· ${t(`email.class.${e.classification}`)}` : ''}
                    </span>
                    {e.keySentence ? <span className="text-ink-2">“{e.keySentence}”</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[13px] leading-normal">{t('detail.noEmails', { domains: application.senderDomains.join(', ') || job.company })}</p>
            )}
            {application.appliedAt ? <p className="m-0 text-[13px] text-ink-3">{t('detail.appliedAgo', { count: daysSince(application.appliedAt) })}</p> : null}
          </Card>
          <Card title={t('detail.notes')}>
            <label htmlFor="notes" className="text-[12.5px] text-ink-3">
              {t('detail.notesLabel')}
            </label>
            <Textarea
              id="notes"
              rows={4}
              value={notes ?? application.notes}
              placeholder={t('detail.notesPlaceholder')}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== null && notes !== application.notes && saveNotes.mutate(notes)}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
