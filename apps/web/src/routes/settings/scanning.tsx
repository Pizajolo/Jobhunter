import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Toggle } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { SearchProfileEditor } from '../../features/search/SearchProfileEditor';
import type { SectionProps } from './sections';

interface SourceRow {
  id: number;
  kind: string;
  name: string;
  enabled: boolean;
  companyId: number | null;
  config: { url?: string; slug?: string };
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastJobCount: number | null;
}
interface CompanyRow {
  id: number;
  name: string;
  careersUrl: string | null;
  atsType: string | null;
  source: 'user' | 'discovered';
  watchStatus: 'watching' | 'suggested' | 'rejected' | 'paused';
  discoveryReason: string | null;
  sources: SourceRow[];
}

export function ScanSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card title={t('settings.scan.title')}>
      <Toggle checked={s.scan.enabled} onChange={(v) => save({ scan: { enabled: v } })} label={t('settings.scan.enabled')} description={t('settings.scan.enabledHint')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="scan-time" label={t('settings.scan.time')}>
          <Input id="scan-time" type="time" defaultValue={s.scan.time} onBlur={(e) => e.target.value && save({ scan: { time: e.target.value } })} />
        </Field>
        <Field id="threshold" label={t('settings.scan.threshold')} hint={t('settings.scan.thresholdHint')}>
          <Input id="threshold" type="number" min={0} max={100} defaultValue={s.matchThresholdShow} onBlur={(e) => save({ matchThresholdShow: Number(e.target.value) })} />
        </Field>
        <Field id="autoshortlist" label={t('settings.scan.autoShortlist')} hint={t('settings.scan.autoShortlistHint')}>
          <Input
            id="autoshortlist"
            type="number"
            min={0}
            max={100}
            placeholder={t('settings.scan.off')}
            defaultValue={s.matchThresholdAutoShortlist ?? ''}
            onBlur={(e) => save({ matchThresholdAutoShortlist: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">{t('settings.scan.etiquette', { seconds: s.scraping.minIntervalMs / 1000, pages: s.scraping.maxPagesPerDomainPerDay })}</p>
    </Card>
  );
}

export function SearchSection() {
  const { t } = useTranslation();
  return (
    <Card title={t('settings.search.title')}>
      <SearchProfileEditor />
    </Card>
  );
}

export function CompaniesSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<CompanyRow[]>('/api/companies') });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['companies'] });
  const add = useMutation({
    mutationFn: () => api.post('/api/companies', { ...(name ? { name } : {}), ...(url ? { careersUrl: url } : {}) }),
    onSuccess: () => {
      setName('');
      setUrl('');
      invalidate();
    },
  });
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: number; status: CompanyRow['watchStatus'] }) => api.patch(`/api/companies/${id}`, { watchStatus: status }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/companies/${id}`), onSuccess: invalidate });
  const list = companies.data ?? [];
  const suggested = list.filter((c) => c.watchStatus === 'suggested');
  const watched = list.filter((c) => c.watchStatus !== 'suggested' && c.watchStatus !== 'rejected');
  return (
    <Card title={t('settings.companies.title')}>
      <div id="companies" />
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name || url) add.mutate();
        }}
      >
        <Field id="co-name" label={t('settings.companies.name')}>
          <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lumen Robotics" />
        </Field>
        <Field id="co-url" label={t('settings.companies.url')}>
          <Input id="co-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/careers" />
        </Field>
        <Button type="submit" variant="primary" busy={add.isPending}>
          {t('settings.companies.add')}
        </Button>
      </form>
      <p className="m-0 text-[12.5px] text-ink-3">{t('settings.companies.hint')}</p>
      <ErrorText error={add.error ?? setStatus.error ?? remove.error} />
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <Toggle checked={s.discovery.enabled} onChange={(v) => save({ discovery: { enabled: v } })} label={t('settings.discovery.enabled')} description={t('settings.discovery.hint')} />
        <Toggle checked={s.discovery.autoAdd} onChange={(v) => save({ discovery: { autoAdd: v } })} label={t('settings.discovery.autoAdd')} disabled={!s.discovery.enabled} />
        <div>
          <Button size="sm" onClick={() => api.post('/api/discovery/run').then(invalidate)} disabled={!s.discovery.enabled}>
            {t('settings.discovery.runNow')}
          </Button>
        </div>
      </div>
      {suggested.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">{t('settings.discovery.suggestions', { count: suggested.length })}</h3>
          {suggested.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3 text-[13.5px]">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">{c.name}</span>
                {c.discoveryReason ? <span className="text-ink-2">{c.discoveryReason}</span> : null}
                {c.careersUrl ? (
                  <a href={c.careersUrl} target="_blank" rel="noreferrer" className="text-[12.5px]">
                    {c.careersUrl}
                  </a>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => setStatus.mutate({ id: c.id, status: 'watching' })}>
                  {t('settings.discovery.accept')}
                </Button>
                <Button size="sm" onClick={() => setStatus.mutate({ id: c.id, status: 'rejected' })}>
                  {t('settings.discovery.reject')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {watched.map((c) => {
          const src = c.sources[0];
          const failing = src?.lastErrorAt && (!src.lastSuccessAt || src.lastErrorAt > src.lastSuccessAt);
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px]">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge kind={c.atsType ? 'info' : 'warn'}>{c.atsType ? t(`sources.${c.atsType}`, { defaultValue: c.atsType }) : t('settings.companies.noSource')}</Badge>
                {c.source === 'discovered' ? <Badge>{t('settings.companies.discovered')}</Badge> : null}
                {failing ? <Badge kind="bad">{t('settings.companies.failing')}</Badge> : null}
                {src?.lastSuccessAt ? <span className="text-[12px] text-ink-3">{t('settings.companies.lastOk', { count: src.lastJobCount ?? 0 })}</span> : null}
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: c.id, status: c.watchStatus === 'paused' ? 'watching' : 'paused' })}>
                  {c.watchStatus === 'paused' ? t('settings.companies.resume') : t('settings.companies.pause')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)} aria-label={`${t('common.remove')}: ${c.name}`}>
                  {t('common.remove')}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function SourcesSection() {
  const { t, i18n } = useTranslation();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get<SourceRow[]>('/api/sources') });
  const [kind, setKind] = useState<'rss' | 'arbeitnow' | 'generic'>('rss');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['sources'] });
  const add = useMutation({
    mutationFn: () =>
      api.post('/api/sources', {
        kind,
        name: name || t(`sources.${kind}`),
        ...(kind !== 'arbeitnow' ? { url } : {}),
        options: kind === 'arbeitnow' ? { keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) } : kind === 'rss' ? { titleFormat: 'company: title' } : {},
      }),
    onSuccess: () => {
      setName('');
      setUrl('');
      invalidate();
    },
  });
  const toggle = useMutation({ mutationFn: (s: SourceRow) => api.patch(`/api/sources/${s.id}`, { enabled: !s.enabled }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/sources/${id}`), onSuccess: invalidate });
  const boards = (sources.data ?? []).filter((s) => s.companyId === null);
  return (
    <Card title={t('settings.sources.title')}>
      <p className="m-0 text-[13px] text-ink-3">{t('settings.sources.hint')}</p>
      <form
        className="grid gap-3 sm:grid-cols-[auto_1fr_1.4fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field id="src-kind" label={t('settings.sources.kind')}>
          <Select id="src-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {(['rss', 'arbeitnow', 'generic'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`sources.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="src-name" label={t('settings.sources.name')}>
          <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'arbeitnow' ? (
          <Field id="src-kw" label={t('settings.sources.keywords')}>
            <Input id="src-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="product, manager" />
          </Field>
        ) : (
          <Field id="src-url" label={t('settings.sources.url')}>
            <Input id="src-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        )}
        <Button type="submit" busy={add.isPending} disabled={kind !== 'arbeitnow' && !url}>
          {t('common.add')}
        </Button>
      </form>
      <ErrorText error={add.error ?? toggle.error ?? remove.error} />
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {boards.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px]">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.name}</span>
              <Badge>{t(`sources.${s.kind}`, { defaultValue: s.kind })}</Badge>
              {!s.enabled ? <Badge kind="muted">{t('settings.sources.disabled')}</Badge> : null}
              {s.lastSuccessAt ? <span className="text-[12px] text-ink-3">{formatDateTime(s.lastSuccessAt, i18n.language)}</span> : null}
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>
                {s.enabled ? t('settings.sources.disable') : t('settings.sources.enable')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}>
                {t('common.remove')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
