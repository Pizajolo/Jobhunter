import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../lib/api';
import { Button, Card, ErrorText, Field, Input, Spinner } from '../components/ui';

interface AuthStatus {
  required: boolean;
  setupNeeded: boolean;
  loggedIn: boolean;
}

/** Server-mode sign-in (spec §2.7): one user, one password. First run asks for the setup code from the server log. */
export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthStatus>('/api/auth/status') });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const done = () => {
    void queryClient.invalidateQueries();
    void navigate('/');
  };
  const login = useMutation({ mutationFn: () => api.post('/api/auth/login', { password }), onSuccess: done });
  const setup = useMutation({ mutationFn: () => api.post('/api/auth/setup', { setupCode: code, password }), onSuccess: done });
  if (!status.data) return <Spinner />;
  const s = status.data;
  if (!s.required || s.loggedIn) {
    void navigate('/');
    return null;
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4">
      <div className="flex items-center gap-2.5">
        <div aria-hidden="true" className="h-7 w-7 rounded-lg bg-accent" />
        <span className="text-[15px] font-bold">Jobhunter</span>
      </div>
      <Card title={s.setupNeeded ? t('login.setupTitle') : t('login.title')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (s.setupNeeded) setup.mutate();
            else login.mutate();
          }}
        >
          {s.setupNeeded ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">{t('login.setupHint')}</p>
              <Field id="setup-code" label={t('login.setupCode')}>
                <Input id="setup-code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field id="password" label={t('login.password')} hint={s.setupNeeded ? t('login.passwordHint') : undefined}>
            <Input id="password" type="password" autoComplete={s.setupNeeded ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {s.setupNeeded ? (
            <Field id="password2" label={t('login.confirm')} error={confirm && confirm !== password ? t('login.mismatch') : undefined}>
              <Input id="password2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          ) : null}
          <Button type="submit" variant="primary" busy={login.isPending || setup.isPending} disabled={!password || (s.setupNeeded && (password !== confirm || password.length < 12 || !code))}>
            {s.setupNeeded ? t('login.setPassword') : t('login.signIn')}
          </Button>
          <ErrorText error={login.error ?? setup.error} />
        </form>
      </Card>
    </div>
  );
}
