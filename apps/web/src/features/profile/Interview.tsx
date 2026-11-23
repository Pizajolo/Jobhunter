import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { Button, ErrorText, Input, Spinner, Textarea } from '../../components/ui';
import { useInterview, type InterviewSession } from './api';
import { VoiceInput, speak } from '../voice/VoiceInput';
import { useSettings } from '../../lib/settings';

/** CV interview: one question at a time, skippable; facts are saved only after the summary is confirmed. */
export function Interview({ onCompleted }: { onCompleted?: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const session = useInterview();
  const [answer, setAnswer] = useState('');
  const [goals, setGoals] = useState('');
  const set = (s: InterviewSession) => queryClient.setQueryData(['interview'], s);

  const start = useMutation({ mutationFn: () => api.post<InterviewSession>('/api/interview/start', { goals: goals || null }), onSuccess: set });
  const reply = useMutation({
    mutationFn: (a: string | null) => api.post<InterviewSession>(`/api/interview/${session.data!.id}/answer`, { answer: a }),
    onSuccess: (s) => {
      setAnswer('');
      set(s);
    },
  });
  const finish = useMutation({ mutationFn: () => api.post<InterviewSession>(`/api/interview/${session.data!.id}/finish`), onSuccess: set });

  const s = session.data;
  const question = s?.state.current?.question;
  useEffect(() => {
    if (question && settings.data?.tts) speak(question, settings.data.language);
  }, [question, settings.data?.tts, settings.data?.language]);

  const busy = start.isPending || reply.isPending || finish.isPending;
  const error = start.error ?? reply.error ?? finish.error;

  if (session.isPending) return <Spinner />;

  if (!s) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">{t('profile.interview.intro')}</p>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          {t('profile.interview.goals')}
          <Input value={goals} onChange={(e) => setGoals(e.target.value)} placeholder={t('profile.interview.goalsPlaceholder')} />
        </label>
        <div>
          <Button variant="primary" busy={start.isPending} onClick={() => start.mutate()}>
            {t('profile.interview.start')}
          </Button>
        </div>
        <ErrorText error={error} />
      </div>
    );
  }

  if (s.status === 'summarizing') {
    return <SummaryReview key={s.id} session={s} onRestart={() => start.mutate()} onCompleted={onCompleted} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] text-ink-3">{t('profile.interview.progress', { count: s.state.history.length + 1 })}</p>
      {question ? (
        <div className="flex flex-col gap-1 rounded-xl bg-sunken p-4">
          <p className="m-0 text-[15px] font-medium" aria-live="polite">
            {question}
          </p>
          {s.state.current?.why ? <p className="m-0 text-[12.5px] text-ink-3">{s.state.current.why}</p> : null}
        </div>
      ) : (
        <Spinner />
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) reply.mutate(answer);
        }}
      >
        <label htmlFor="interview-answer" className="sr-only">
          {t('profile.interview.answer')}
        </label>
        <Textarea id="interview-answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t('profile.interview.answerPlaceholder')} />
        <VoiceInput onTranscript={(text) => setAnswer((a) => (a ? `${a} ${text}` : text))} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={reply.isPending} disabled={!answer.trim() || busy}>
            {t('profile.interview.send')}
          </Button>
          <Button disabled={busy} onClick={() => reply.mutate(null)}>
            {t('common.skip')}
          </Button>
          <Button variant="ghost" disabled={busy} busy={finish.isPending} onClick={() => finish.mutate()}>
            {t('profile.interview.finish')}
          </Button>
        </div>
      </form>
      <ErrorText error={error} />
    </div>
  );
}

function SummaryReview({ session, onRestart, onCompleted }: { session: InterviewSession; onRestart: () => void; onCompleted?: () => void }) {
  const { t } = useTranslation();
  const [facts, setFacts] = useState(() => (session.state.summary?.facts ?? []).map((f) => ({ text: f.text, category: f.category, keep: true })));
  const confirm = useMutation({
    mutationFn: () => api.post(`/api/interview/${session.id}/confirm`, { facts: facts.filter((f) => f.keep).map(({ text, category }) => ({ text, category })) }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onCompleted?.();
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold">{t('profile.interview.summaryTitle')}</h3>
      {session.state.summary?.summary ? <p className="m-0 text-sm text-ink-2">{session.state.summary.summary}</p> : null}
      <p className="m-0 text-[13px] text-ink-3">{t('profile.interview.summaryHint')}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {facts.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-3"
              aria-label={t('profile.interview.keep')}
              checked={f.keep}
              onChange={(e) => setFacts((x) => x.map((y, j) => (j === i ? { ...y, keep: e.target.checked } : y)))}
            />
            <Textarea rows={2} value={f.text} onChange={(e) => setFacts((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
          </li>
        ))}
      </ul>
      {facts.length === 0 ? <p className="m-0 text-sm text-ink-3">{t('profile.interview.noFacts')}</p> : null}
      <div className="flex gap-2">
        <Button variant="primary" busy={confirm.isPending} onClick={() => confirm.mutate()}>
          {t('profile.interview.confirm', { count: facts.filter((f) => f.keep).length })}
        </Button>
        <Button onClick={onRestart}>{t('profile.interview.restart')}</Button>
      </div>
      <ErrorText error={confirm.error} />
    </div>
  );
}
