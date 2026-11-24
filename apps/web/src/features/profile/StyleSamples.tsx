import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { Button, ErrorText, Field, Select, Textarea } from '../../components/ui';
import { LANGUAGE_NAMES } from '../../routes/settings/sections';
import { useStyle } from './api';
import { useQuery } from '@tanstack/react-query';

/** Writing samples per language → style profile (spec §5.1 step 5). */
export function StyleSamples({ defaultLanguage }: { defaultLanguage: string }) {
  const { t } = useTranslation();
  const style = useStyle();
  const [language, setLanguage] = useState(defaultLanguage);
  const [text, setText] = useState('');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['style'] });
  const add = useMutation({
    mutationFn: () => api.post('/api/style/samples', { language, text }),
    onSuccess: () => {
      setText('');
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/style/samples/${id}`), onSuccess: invalidate });
  const analyze = useMutation({ mutationFn: () => api.post('/api/style/analyze', { language }), onSuccess: invalidate });
  const proposals = useQuery({ queryKey: ['style', 'proposals'], queryFn: () => api.get<{ id: number; language: string; rules: string[] }[]>('/api/style/proposals') });
  const decide = useMutation({ mutationFn: ({ id, accept }: { id: number; accept: boolean }) => api.post(`/api/style/proposals/${id}`, { accept }), onSuccess: invalidate });
  const samples = style.data?.samples.filter((s) => s.language === language) ?? [];
  const profile = style.data?.profiles.find((p) => p.language === language);

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{t('profile.style.intro')}</p>
      {proposals.data?.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft p-3 text-[13.5px]">
          <strong>{t('profile.style.proposal', { lang: LANGUAGE_NAMES[p.language] ?? p.language })}</strong>
          <ul className="m-0 pl-5">
            {p.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: p.id, accept: true })}>
              {t('profile.style.acceptRules')}
            </Button>
            <Button size="sm" onClick={() => decide.mutate({ id: p.id, accept: false })}>
              {t('chat.reject')}
            </Button>
          </div>
        </div>
      ))}
      <Field id="style-lang" label={t('profile.style.language')}>
        <Select id="style-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="max-w-xs">
          {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="style-text" label={t('profile.style.paste')} hint={t('profile.style.pasteHint')}>
        <Textarea id="style-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button busy={add.isPending} disabled={text.trim().length < 40} onClick={() => add.mutate()}>
          {t('profile.style.add')}
        </Button>
        <Button variant="primary" busy={analyze.isPending} disabled={samples.length === 0} onClick={() => analyze.mutate()}>
          {t('profile.style.analyze', { count: samples.length })}
        </Button>
      </div>
      <ErrorText error={add.error ?? analyze.error ?? remove.error} />
      {samples.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {samples.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-line p-2.5 text-[13px]">
              <span className="line-clamp-2 text-ink-2">{s.text}</span>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}>
                {t('common.remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {profile ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-ground p-4 text-[13.5px]">
          <h3 className="m-0 text-sm font-semibold">{t('profile.style.result')}</h3>
          <p className="m-0">{profile.description}</p>
          <p className="m-0 text-ink-2">
            <strong>{t('profile.style.tone')}:</strong> {profile.tone} · <strong>{t('profile.style.formality')}:</strong> {profile.formality}
          </p>
          {profile.avoid.length ? (
            <p className="m-0 text-ink-2">
              <strong>{t('profile.style.avoid')}:</strong> {profile.avoid.join('; ')}
            </p>
          ) : null}
          {profile.rules.length ? (
            <div>
              <strong>{t('profile.style.rules')}</strong>
              <ul className="m-0 pl-5">
                {profile.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
