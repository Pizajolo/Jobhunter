import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AuthMode, ClaudeStatus } from '@jobhunter/shared';
import { api, queryClient } from '../lib/api';
import { Badge, Button, ErrorText, Field, Input } from './ui';

const MODES: AuthMode[] = ['subscription', 'api_key', 'compatible', 'openai_proxy'];

/** Connect Claude (spec §2.1, §5.1 step 2). Jobhunter never sees Claude login credentials. */
export function ClaudeAccount({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['claude-status'], queryFn: () => api.get<ClaudeStatus>('/api/claude/status') });
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['claude-status'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };
  const setMode = useMutation({
    mutationFn: (mode: AuthMode) =>
      api.post<ClaudeStatus>('/api/claude/mode', { mode, ...(mode === 'compatible' || mode === 'openai_proxy' ? { compatibleBaseUrl: baseUrl || null } : {}) }),
    onSuccess: invalidate,
  });
  const saveKey = useMutation({
    mutationFn: () =>
      Promise.all([
        status.data?.mode === 'compatible' || status.data?.mode === 'openai_proxy'
          ? api.post('/api/claude/mode', { mode: status.data.mode, compatibleBaseUrl: baseUrl })
          : Promise.resolve(null),
        api.put('/api/claude/api-key', { key, kind: status.data?.mode === 'api_key' ? 'anthropic' : 'compatible' }),
      ]),
    onSuccess: () => {
      setKey('');
      invalidate();
    },
  });
  const test = useMutation({ mutationFn: () => api.post<{ ok: boolean; reply?: string; error?: string; model?: string }>('/api/claude/test') });

  const s = status.data;
  const mode = s?.mode as AuthMode | undefined;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium text-ink-2">{t('claude.method')}</legend>
        {MODES.map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="radio" name="claude-mode" className="mt-1" checked={mode === m} onChange={() => setMode.mutate(m)} />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {t(`claude.modes.${m}.title`)} {m === 'subscription' ? <Badge kind="info">{t('claude.default')}</Badge> : null}
                {m === 'openai_proxy' ? <Badge kind="warn">{t('claude.experimental')}</Badge> : null}
              </span>
              {!compact ? <span className="text-[12.5px] text-ink-3">{t(`claude.modes.${m}.desc`)}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-ground p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t('claude.status')}</span>
          {s ? <Badge kind={s.connected ? 'ok' : 'warn'}>{s.connected ? t('common.connected') : t('common.notConnected')}</Badge> : null}
          <span className="text-ink-3">{s?.detail}</span>
        </div>
        {s?.account?.email ? <span className="text-[13px] text-ink-2">{s.account.email} {s.account.subscriptionType ? `· ${s.account.subscriptionType}` : ''}</span> : null}

        {mode === 'subscription' && s && !s.connected ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[13px]">{t('claude.loginHelp')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-surface px-2.5 py-1.5 text-[13px] break-all">{s.loginCommand}</code>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(s.loginCommand ?? '');
                  setCopied(true);
                }}
              >
                {copied ? t('claude.copied') : t('claude.copy')}
              </Button>
            </div>
            <p className="m-0 text-[12.5px] text-ink-3">{t('claude.loginNote')}</p>
          </div>
        ) : null}

        {mode === 'api_key' || mode === 'compatible' || mode === 'openai_proxy' ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveKey.mutate();
            }}
          >
            {mode !== 'api_key' ? (
              <Field id="claude-base-url" label={t('claude.baseUrl')} hint={t('claude.baseUrlHint')}>
                <Input id="claude-base-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/anthropic" />
              </Field>
            ) : null}
            <Field id="claude-key" label={mode === 'api_key' ? t('claude.apiKey') : t('claude.providerKey')} hint={t('claude.keyHint')}>
              <Input id="claude-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" variant="primary" busy={saveKey.isPending} disabled={key.length < 10}>
                {t('claude.saveKey')}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void status.refetch()} busy={status.isFetching}>
            {t('claude.checkAgain')}
          </Button>
          <Button size="sm" onClick={() => test.mutate()} busy={test.isPending} disabled={!s?.connected}>
            {t('claude.test')}
          </Button>
          {test.data ? (
            <span className={test.data.ok ? 'text-[13px] text-ok-ink' : 'text-[13px] text-bad-ink'}>
              {test.data.ok ? `${test.data.reply ?? ''} (${test.data.model ?? ''})` : test.data.error}
            </span>
          ) : null}
        </div>
        <ErrorText error={setMode.error ?? saveKey.error} />
      </div>
      {mode === 'subscription' && !compact ? <p className="m-0 text-[12.5px] text-ink-3">{t('claude.termsNote')}</p> : null}
    </div>
  );
}
