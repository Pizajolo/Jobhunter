import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SearchProfile } from '@jobhunter/shared';
import { api, queryClient } from '../../lib/api';
import { Button, ErrorText, Field, Input, Select, Spinner } from '../../components/ui';
import { ChatPanelInline } from './ChatInline';

type ListKey = 'roles' | 'seniority' | 'locations' | 'industries' | 'mustHave' | 'niceToHave' | 'exclusions' | 'excludedCompanies' | 'languages';
const LISTS: ListKey[] = ['roles', 'seniority', 'locations', 'industries', 'mustHave', 'niceToHave', 'exclusions', 'excludedCompanies', 'languages'];

function ListInput({ id, label, value, onChange }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <Field id={id} label={label}>
      <Input id={id} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(',').map((x) => x.trim()).filter(Boolean))} />
    </Field>
  );
}

/** Search profile as a form plus a chat that proposes structured changes (spec §5.1 step 6). */
export function SearchProfileEditor() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['search-profile'], queryFn: () => api.get<{ data: SearchProfile; version: number }>('/api/search-profile') });
  if (!q.data) return <Spinner />;
  return <Editor key={q.data.version} initial={q.data.data} t={t} />;
}

function Editor({ initial, t }: { initial: SearchProfile; t: ReturnType<typeof useTranslation>['t'] }) {
  const [p, setP] = useState(initial);
  const save = useMutation({
    mutationFn: (data: SearchProfile) => api.put('/api/search-profile', data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['search-profile'] }),
  });
  const update = (patch: Partial<SearchProfile>) => {
    const next = { ...p, ...patch };
    setP(next);
    save.mutate(next);
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {LISTS.map((k) => (
          <ListInput key={k} id={`sp-${k}`} label={t(`search.fields.${k}`)} value={p[k]} onChange={(v) => update({ [k]: v })} />
        ))}
        <Field id="sp-remote" label={t('search.fields.remotePolicy')}>
          <Select id="sp-remote" value={p.remotePolicy} onChange={(e) => update({ remotePolicy: e.target.value as SearchProfile['remotePolicy'] })}>
            {(['any', 'remote_only', 'hybrid_ok', 'onsite_ok'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`search.remote.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Field id="sp-salary" label={t('search.fields.minSalary')}>
            <Input
              id="sp-salary"
              type="number"
              min={0}
              defaultValue={p.minSalary?.amount ?? ''}
              onBlur={(e) => update({ minSalary: e.target.value ? { amount: Number(e.target.value), currency: p.minSalary?.currency ?? 'CHF' } : null })}
            />
          </Field>
          <Field id="sp-currency" label={t('search.fields.currency')}>
            <Select id="sp-currency" value={p.minSalary?.currency ?? 'CHF'} onChange={(e) => p.minSalary && update({ minSalary: { ...p.minSalary, currency: e.target.value } })}>
              {['CHF', 'EUR', 'USD', 'GBP', 'MXN'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">{t('search.hint')}</p>
      <ErrorText error={save.error} />
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('search.chatTitle')}</h3>
        <ChatPanelInline thread="search" placeholder={t('search.chatPlaceholder')} />
      </div>
      <div>
        <Button onClick={() => api.post('/api/matches/rescore')}>{t('search.rescore')}</Button>
      </div>
    </div>
  );
}
