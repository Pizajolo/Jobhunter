import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@jobhunter/shared';
import { api, queryClient } from '../../lib/api';
import { Badge, Button, ErrorText, Input, Textarea } from '../../components/ui';
import type { ProfileImport } from './api';

type ListSection = 'work' | 'education' | 'skills' | 'languages' | 'projects' | 'certificates' | 'achievements';
type FieldDef = { key: string; kind?: 'lines' | 'csv' | 'long' };

const FIELDS: Record<ListSection, FieldDef[]> = {
  work: [{ key: 'position' }, { key: 'name' }, { key: 'location' }, { key: 'startDate' }, { key: 'endDate' }, { key: 'summary', kind: 'long' }, { key: 'highlights', kind: 'lines' }],
  education: [{ key: 'studyType' }, { key: 'area' }, { key: 'institution' }, { key: 'location' }, { key: 'startDate' }, { key: 'endDate' }, { key: 'score' }],
  skills: [{ key: 'name' }, { key: 'level' }, { key: 'keywords', kind: 'csv' }],
  languages: [{ key: 'language' }, { key: 'fluency' }],
  projects: [{ key: 'name' }, { key: 'description', kind: 'long' }, { key: 'startDate' }, { key: 'endDate' }, { key: 'highlights', kind: 'lines' }],
  certificates: [{ key: 'name' }, { key: 'issuer' }, { key: 'date' }],
  achievements: [{ key: 'text', kind: 'long' }, { key: 'metric' }],
};
const SECTIONS = Object.keys(FIELDS) as ListSection[];
const BASICS = ['name', 'label', 'email', 'phone', 'url', 'summary'] as const;

type Item = Record<string, unknown> & { id: string };

function title(section: ListSection, item: Item): string {
  switch (section) {
    case 'work':
      return `${String(item.position ?? '')} · ${String(item.name ?? '')}`;
    case 'education':
      return `${[item.studyType, item.area].filter(Boolean).join(' ')} · ${String(item.institution ?? '')}`;
    case 'languages':
      return `${String(item.language)}${item.fluency ? ` (${String(item.fluency)})` : ''}`;
    case 'achievements':
      return String(item.text ?? '');
    default:
      return String(item.name ?? '');
  }
}

function toText(v: unknown, kind?: FieldDef['kind']): string {
  if (Array.isArray(v)) return v.join(kind === 'csv' ? ', ' : '\n');
  return typeof v === 'string' ? v : '';
}
function fromText(v: string, kind?: FieldDef['kind']): unknown {
  if (kind === 'lines') return v.split('\n').map((x) => x.trim()).filter(Boolean);
  if (kind === 'csv') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return v.trim() ? v : undefined;
}

/** Side-by-side review: the extracted text on the left, each extracted item to confirm, edit or delete on the right. */
export function CvReview({ imp, onDone }: { imp: ProfileImport; onDone: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Profile>(() => structuredClone(imp.extracted!));
  const [decisions, setDecisions] = useState<Record<string, 'ok' | 'deleted'>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const keys = useMemo(() => SECTIONS.flatMap((s) => (draft[s] as Item[]).map((i) => `${s}:${i.id}`)), [draft]);
  const undecided = keys.filter((k) => !decisions[k]).length;

  const apply = useMutation({
    mutationFn: () => {
      const out: Profile = structuredClone(draft);
      for (const s of SECTIONS) {
        (out[s] as Item[]) = (draft[s] as Item[]).filter((i) => decisions[`${s}:${i.id}`] !== 'deleted');
      }
      return api.post(`/api/profile/imports/${imp.id}/apply`, { profile: out });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onDone();
    },
  });
  const discard = useMutation({
    mutationFn: () => api.post(`/api/profile/imports/${imp.id}/discard`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-import'] });
      onDone();
    },
  });

  const updateItem = (s: ListSection, id: string, field: FieldDef, value: string) =>
    setDraft((d) => ({ ...d, [s]: (d[s] as Item[]).map((i) => (i.id === id ? { ...i, [field.key]: fromText(value, field.kind) } : i)) }));

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{t('profile.review.intro')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label={t('profile.review.original')} className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-ground p-4 lg:sticky lg:top-4">
          <h3 className="m-0 text-sm font-semibold">{t('profile.review.original')} · {imp.filename}</h3>
          <pre className="m-0 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{imp.text}</pre>
        </section>
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <h3 className="m-0 text-sm font-semibold">{t('profile.review.basics')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {BASICS.map((k) => (
                <label key={k} className={clsx('flex flex-col gap-1 text-[12.5px] text-ink-3', k === 'summary' && 'sm:col-span-2')}>
                  {t(`profile.fields.${k}`)}
                  {k === 'summary' ? (
                    <Textarea rows={3} value={draft.basics[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, basics: { ...d.basics, [k]: e.target.value } }))} />
                  ) : (
                    <Input value={draft.basics[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, basics: { ...d.basics, [k]: e.target.value } }))} />
                  )}
                </label>
              ))}
            </div>
          </section>
          {SECTIONS.map((s) => {
            const items = draft[s] as Item[];
            if (items.length === 0) return null;
            return (
              <section key={s} className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-semibold">{t(`profile.sections.${s}`)}</h3>
                {items.map((item) => {
                  const k = `${s}:${item.id}`;
                  const d = decisions[k];
                  return (
                    <div key={k} className={clsx('flex flex-col gap-2 rounded-xl border bg-surface p-3', d === 'deleted' ? 'border-dashed border-line-strong opacity-60' : d === 'ok' ? 'border-ok-ink/40' : 'border-line')}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className={clsx('text-[13.5px] font-medium', d === 'deleted' && 'line-through')}>{title(s, item)}</span>
                        {d ? <Badge kind={d === 'ok' ? 'ok' : 'muted'}>{d === 'ok' ? t('profile.review.confirmed') : t('profile.review.deleted')}</Badge> : null}
                      </div>
                      {s === 'work' && Array.isArray(item.highlights) && editing !== k ? (
                        <ul className="m-0 pl-5 text-[13px] text-ink-2">
                          {(item.highlights as string[]).map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      ) : null}
                      {editing === k ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {FIELDS[s].map((f) => (
                            <label key={f.key} className={clsx('flex flex-col gap-1 text-[12.5px] text-ink-3', f.kind && f.kind !== 'csv' && 'sm:col-span-2')}>
                              {t(`profile.fields.${f.key}`)}
                              {f.kind === 'lines' || f.kind === 'long' ? (
                                <Textarea rows={f.kind === 'lines' ? 4 : 2} value={toText(item[f.key], f.kind)} onChange={(e) => updateItem(s, item.id, f, e.target.value)} />
                              ) : (
                                <Input value={toText(item[f.key], f.kind)} onChange={(e) => updateItem(s, item.id, f, e.target.value)} />
                              )}
                            </label>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant={d === 'ok' ? 'primary' : 'secondary'} onClick={() => setDecisions((x) => ({ ...x, [k]: 'ok' }))}>
                          {t('profile.review.confirm')}
                        </Button>
                        <Button size="sm" onClick={() => setEditing(editing === k ? null : k)}>
                          {editing === k ? t('profile.review.doneEditing') : t('common.edit')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDecisions((x) => ({ ...x, [k]: d === 'deleted' ? 'ok' : 'deleted' }))}>
                          {d === 'deleted' ? t('profile.review.restore') : t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
          <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <Button variant="primary" busy={apply.isPending} disabled={undecided > 0} onClick={() => apply.mutate()}>
              {t('profile.review.save')}
            </Button>
            <Button onClick={() => setDecisions(Object.fromEntries(keys.map((k) => [k, decisions[k] ?? 'ok'])))}>{t('profile.review.confirmAll')}</Button>
            <Button variant="ghost" onClick={() => discard.mutate()}>
              {t('profile.review.discard')}
            </Button>
            {undecided > 0 ? <span className="text-[13px] text-ink-3">{t('profile.review.remaining', { count: undecided })}</span> : null}
          </div>
          <ErrorText error={apply.error} />
        </div>
      </div>
    </div>
  );
}
