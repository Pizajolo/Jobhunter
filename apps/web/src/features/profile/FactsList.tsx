import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProfileFact } from '@jobhunter/shared';
import { api, queryClient } from '../../lib/api';
import { Badge, Button, ErrorText, Input } from '../../components/ui';

/** Confirmed facts: the only material the writers may use (spec §2.4). */
export function FactsList({ facts }: { facts: ProfileFact[] }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['profile'] });
  const add = useMutation({
    mutationFn: () => api.post('/api/profile/facts', { text, category: 'other' }),
    onSuccess: () => {
      setText('');
      invalidate();
    },
  });
  const save = useMutation({
    mutationFn: (e: { id: string; text: string }) => api.patch(`/api/profile/facts/${e.id}`, { text: e.text }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/profile/facts/${id}`), onSuccess: invalidate });
  const shown = facts.filter((f) => f.confirmedAt && (!filter || f.text.toLowerCase().includes(filter.toLowerCase())));

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-ink-3">{t('profile.facts.hint')}</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) add.mutate();
        }}
      >
        <label htmlFor="new-fact" className="sr-only">
          {t('profile.facts.add')}
        </label>
        <Input id="new-fact" className="min-w-64 flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('profile.facts.addPlaceholder')} />
        <Button type="submit" busy={add.isPending}>
          {t('profile.facts.add')}
        </Button>
      </form>
      <label htmlFor="fact-filter" className="sr-only">
        {t('common.search')}
      </label>
      <Input id="fact-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('common.search')} className="max-w-sm" />
      <ErrorText error={add.error ?? save.error ?? del.error} />
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {shown.map((f) => (
          <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px]">
            {editing?.id === f.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate(editing);
                }}
              >
                <Input aria-label={t('common.edit')} value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} />
                <Button size="sm" type="submit" variant="primary">
                  {t('common.save')}
                </Button>
              </form>
            ) : (
              <span className="flex-1">{f.text}</span>
            )}
            <span className="flex items-center gap-1.5">
              <Badge kind={f.source === 'interview' ? 'info' : f.source === 'manual' ? 'warn' : 'muted'}>{t(`profile.facts.source.${f.source}`)}</Badge>
              {f.source !== 'cv' && editing?.id !== f.id ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: f.id, text: f.text })}>
                  {t('common.edit')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" aria-label={`${t('common.delete')}: ${f.text}`} onClick={() => del.mutate(f.id)}>
                {t('common.delete')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="m-0 text-sm text-ink-3">{t('profile.facts.none')}</p> : null}
    </div>
  );
}
