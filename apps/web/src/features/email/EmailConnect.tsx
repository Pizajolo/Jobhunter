import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSettings, useUpdateSettings } from '../../lib/settings';
import { Badge, Button, ErrorText, Field, Input, Tabs, Toggle } from '../../components/ui';

export interface EmailStatus {
  provider: 'none' | 'gmail_api' | 'imap';
  address: string | null;
  connected: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  gmailClientId: string | null;
}

export function useEmailStatus() {
  return useQuery({ queryKey: ['email-status'], queryFn: () => api.get<EmailStatus>('/api/email/status') });
}

/** Connect Gmail with the user's own OAuth client, or IMAP with an app password (spec §2.2, §5.5). */
export function EmailConnect() {
  const { t, i18n } = useTranslation();
  const status = useEmailStatus();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [method, setMethod] = useState<'gmail_api' | 'imap'>('imap');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [address, setAddress] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['email-status'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };
  const startGmail = useMutation({
    mutationFn: () => api.post<{ url: string }>('/api/email/gmail/start', { clientId, ...(clientSecret ? { clientSecret } : {}) }),
    onSuccess: (r) => {
      window.open(r.url, '_blank', 'noopener');
    },
  });
  const connectImap = useMutation({
    mutationFn: () => api.post('/api/email/imap', { address, appPassword }),
    onSuccess: () => {
      setAppPassword('');
      invalidate();
    },
  });
  const sync = useMutation({ mutationFn: () => api.post<{ processed: number; changed: number; review: number }>('/api/email/sync'), onSuccess: invalidate });
  const disconnect = useMutation({ mutationFn: () => api.post('/api/email/disconnect'), onSuccess: invalidate });
  const sample = useMutation({ mutationFn: () => api.post<{ added: number }>('/api/email/sample-sent') });

  const s = status.data;
  if (s && s.provider !== 'none') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge kind={s.lastError ? 'bad' : 'ok'}>{s.lastError ? t('email.connect.error') : t('common.connected')}</Badge>
          <span className="font-medium">{s.address}</span>
          <span className="text-ink-3">{t(`email.connect.via.${s.provider}`)}</span>
        </div>
        {s.lastSyncAt ? <p className="m-0 text-[13px] text-ink-3">{t('email.connect.lastSync', { when: formatDateTime(s.lastSyncAt, i18n.language) })}</p> : null}
        {s.lastError ? <ErrorText error={s.lastError} /> : null}
        {sync.data ? <p className="m-0 text-[13px] text-ok-ink">{t('email.connect.synced', sync.data)}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button busy={sync.isPending} onClick={() => sync.mutate()}>
            {t('email.connect.syncNow')}
          </Button>
          <Button variant="danger" onClick={() => disconnect.mutate()}>
            {t('email.connect.disconnect')}
          </Button>
        </div>
        {settings.data ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <Toggle checked={settings.data.email.applyLabels} onChange={(v) => update.mutate({ email: { applyLabels: v } })} label={t('email.connect.labels')} description={t('email.connect.labelsHint')} />
            <Toggle
              checked={settings.data.email.sampleSentForStyle}
              onChange={(v) => update.mutate({ email: { sampleSentForStyle: v } })}
              label={t('email.connect.sampleSent')}
              description={t('email.connect.sampleSentHint')}
            />
            {settings.data.email.sampleSentForStyle ? (
              <div className="flex items-center gap-2">
                <Button size="sm" busy={sample.isPending} onClick={() => sample.mutate()}>
                  {t('email.connect.sampleNow')}
                </Button>
                {sample.data ? <span className="text-[13px] text-ink-2">{t('email.connect.sampled', { count: sample.data.added })}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <ErrorText error={sync.error ?? disconnect.error ?? sample.error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{t('email.connect.intro')}</p>
      <Tabs<'gmail_api' | 'imap'>
        label={t('email.connect.method')}
        value={method}
        onChange={setMethod}
        tabs={[
          { id: 'imap', label: t('email.connect.imapTab') },
          { id: 'gmail_api', label: t('email.connect.gmailTab') },
        ]}
      />
      {method === 'imap' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            connectImap.mutate();
          }}
        >
          <p className="m-0 text-[13px] text-ink-3">{t('email.connect.imapHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="imap-address" label={t('email.connect.address')}>
              <Input id="imap-address" type="email" autoComplete="email" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field id="imap-password" label={t('email.connect.appPassword')} hint={t('email.connect.appPasswordHint')}>
              <Input id="imap-password" type="password" autoComplete="off" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="primary" busy={connectImap.isPending} disabled={!address || appPassword.length < 8}>
              {t('email.connect.connect')}
            </Button>
          </div>
          <ErrorText error={connectImap.error} />
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startGmail.mutate();
          }}
        >
          <p className="m-0 text-[13px] text-ink-3">{t('email.connect.gmailHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="gmail-client-id" label={t('email.connect.clientId')}>
              <Input id="gmail-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" />
            </Field>
            <Field id="gmail-client-secret" label={t('email.connect.clientSecret')}>
              <Input id="gmail-client-secret" type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" busy={startGmail.isPending} disabled={clientId.length < 10}>
              {t('email.connect.signInGoogle')}
            </Button>
            <Button onClick={invalidate}>{t('claude.checkAgain')}</Button>
          </div>
          {startGmail.isSuccess ? <p className="m-0 text-[13px] text-ink-2">{t('email.connect.finishInBrowser')}</p> : null}
          <ErrorText error={startGmail.error} />
        </form>
      )}
      <p className="m-0 text-[12.5px] text-ink-3">{t('email.connect.privacy')}</p>
    </div>
  );
}
