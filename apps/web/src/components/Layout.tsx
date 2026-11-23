import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { ChatPanel } from './ChatPanel';
import { NotificationsButton } from './Notifications';

export interface Summary {
  approvals: number;
  reviewQueue: number;
  model: string;
  claudeConnected: boolean;
  emailProvider: string;
  emailConnected: boolean;
  nextScanAt: string | null;
  lastScanAt: string | null;
  unreadNotifications: number;
  mode: 'desktop' | 'server' | 'dev';
}

export function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => api.get<Summary>('/api/summary'), refetchInterval: 60_000 });
}

function NavItem({ to, children, count, onClick }: { to: string; children: ReactNode; count?: number; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'flex items-center justify-between rounded-lg px-2.5 py-2 text-sm no-underline',
          isActive ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-ink-2 hover:bg-sunken',
        )
      }
    >
      <span>{children}</span>
      {count ? (
        <span className="rounded-full bg-warn-soft px-2 py-px text-xs font-semibold text-warn-ink" aria-label={String(count)}>
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const summary = useSummary();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const location = useLocation();
  const s = summary.data;
  const close = () => setMenuOpen(false);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        {t('nav.skip')}
      </a>
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <NotificationsButton />
          <button
            type="button"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {t('nav.menu')}
          </button>
        </div>
      </header>
      <nav
        id="main-nav"
        aria-label={t('nav.main')}
        className={clsx(
          'flex-col gap-5 border-line bg-surface px-3.5 py-5 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:border-r',
          menuOpen ? 'flex border-b' : 'hidden',
        )}
      >
        <div className="hidden items-center justify-between px-2 md:flex">
          <Brand />
          <NotificationsButton />
        </div>
        <div className="flex flex-col gap-0.5">
          <NavItem to="/" onClick={close}>
            {t('nav.pipeline')}
          </NavItem>
          <NavItem to="/approvals" count={s?.approvals} onClick={close}>
            {t('nav.approvals')}
          </NavItem>
          <NavItem to="/review" count={s?.reviewQueue} onClick={close}>
            {t('nav.review')}
          </NavItem>
          <NavItem to="/inbox" onClick={close}>
            {t('nav.inbox')}
          </NavItem>
          <NavItem to="/stats" onClick={close}>
            {t('nav.stats')}
          </NavItem>
          <NavItem to="/profile" onClick={close}>
            {t('nav.profile')}
          </NavItem>
          <NavItem to="/settings" onClick={close}>
            {t('nav.settings')}
          </NavItem>
          <NavItem to="/diagnostics" onClick={close}>
            {t('nav.diagnostics')}
          </NavItem>
        </div>
        <div className="mt-auto flex flex-col gap-2 rounded-xl border border-line p-3.5 text-[12.5px]">
          <span className="text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t('nav.agent')}</span>
          <Row label={t('nav.model')} value={s?.model ?? '—'} />
          <Row label="Claude" value={s ? (s.claudeConnected ? t('common.connected') : t('common.notConnected')) : '—'} />
          <Row label={t('nav.email')} value={s ? (s.emailConnected ? t('common.connected') : t('common.notConnected')) : '—'} />
          <Row
            label={t('nav.nextScan')}
            value={
              s?.nextScanAt
                ? new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.nextScanAt))
                : '—'
            }
          />
          <NavLink to="/settings" onClick={close} className="font-medium">
            {t('nav.agentSettings')}
          </NavLink>
        </div>
      </nav>
      <main id="main" className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-6 sm:px-7" key={location.pathname}>
        <Outlet />
      </main>
      <ChatPanel open={chatOpen} onToggle={() => setChatOpen((v) => !v)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-3">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div aria-hidden="true" className="h-7 w-7 rounded-lg bg-accent" />
      <span className="text-[15px] font-bold">Jobhunter</span>
    </div>
  );
}
