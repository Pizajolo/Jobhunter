import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsButton() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<NotificationItem[]>('/api/notifications') });
  const markRead = useMutation({
    mutationFn: () => api.post('/api/notifications/read'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });
  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('notifications.title', { count: unread })}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) markRead.mutate();
        }}
        className="relative rounded-lg px-2 py-1.5 text-ink-2 hover:bg-sunken"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0" />
        </svg>
        {unread ? <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-accent" /> : null}
      </button>
      {open ? (
        <div className="absolute top-10 left-0 z-40 flex max-h-96 w-80 flex-col overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-xl md:left-0">
          {q.data?.length ? (
            q.data.slice(0, 30).map((n) => (
              <div key={n.id} className="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-sunken">
                {n.link ? (
                  <Link to={n.link} className="font-semibold" onClick={() => setOpen(false)}>
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-semibold">{n.title}</span>
                )}
                <span className="text-ink-2">{n.body}</span>
                <span className="text-[11.5px] text-ink-3">{formatDateTime(n.createdAt, i18n.language)}</span>
              </div>
            ))
          ) : (
            <p className="m-2 text-[13px] text-ink-3">{t('notifications.empty')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
