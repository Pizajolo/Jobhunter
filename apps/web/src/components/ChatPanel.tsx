import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DiffEntry } from '@jobhunter/shared';
import { api, queryClient } from '../lib/api';
import { Button, DiffView, ErrorText, Textarea } from './ui';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  proposal: { kind: string; summary: string; diff: DiffEntry[] } | null;
  proposalStatus: 'pending' | 'applied' | 'rejected' | null;
  createdAt: string;
}

/** Collapsible chat available on every screen (spec §5.7.9). Changes are always confirmed as diffs. */
export function ChatPanel({ open, onToggle, thread = 'global' }: { open: boolean; onToggle: () => void; thread?: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['chat', thread],
    queryFn: () => api.get<ChatMessage[]>(`/api/chat?thread=${encodeURIComponent(thread)}`),
    enabled: open,
  });
  const send = useMutation({
    mutationFn: (content: string) => api.post<ChatMessage[]>('/api/chat', { thread, content }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['chat', thread] });
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'apply' | 'reject' }) => api.post(`/api/chat/proposals/${id}/${action}`),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.data, send.isPending]);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="chat-panel"
        className="fixed right-4 bottom-4 z-30 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-on-accent shadow-lg"
      >
        {open ? t('chat.close') : t('chat.open')}
      </button>
      <aside
        id="chat-panel"
        aria-label={t('chat.title')}
        className={clsx(
          'fixed inset-x-0 bottom-0 z-20 flex h-[75vh] flex-col border-t border-line bg-surface shadow-2xl md:inset-x-auto md:top-0 md:right-0 md:h-screen md:w-[400px] md:border-t-0 md:border-l',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="m-0 text-[15px] font-semibold">{t('chat.title')}</h2>
        </div>
        <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.data?.length === 0 ? <p className="m-0 text-[13px] text-ink-3">{t('chat.hint')}</p> : null}
          {messages.data?.map((m) => (
            <div
              key={m.id}
              className={clsx(
                'flex max-w-[92%] flex-col gap-2 rounded-xl px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap',
                m.role === 'user' ? 'self-end bg-accent-soft text-ink' : 'self-start bg-sunken text-ink',
              )}
            >
              <span>{m.content}</span>
              {m.proposal ? (
                <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
                  <span className="text-[12.5px] font-semibold">{m.proposal.summary}</span>
                  <DiffView diff={m.proposal.diff} />
                  {m.proposalStatus === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" busy={decide.isPending} onClick={() => decide.mutate({ id: m.id, action: 'apply' })}>
                        {t('chat.apply')}
                      </Button>
                      <Button size="sm" onClick={() => decide.mutate({ id: m.id, action: 'reject' })}>
                        {t('chat.reject')}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-3">{t(`chat.status.${m.proposalStatus ?? 'pending'}`)}</span>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {send.isPending ? <p className="m-0 text-[13px] text-ink-3">{t('chat.thinking')}</p> : null}
          <ErrorText error={send.error ?? decide.error} />
        </div>
        <form
          className="flex flex-col gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send.mutate(text.trim());
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            {t('chat.placeholder')}
          </label>
          <Textarea
            id="chat-input"
            rows={2}
            value={text}
            placeholder={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) send.mutate(text.trim());
              }
            }}
          />
          <Button type="submit" variant="primary" busy={send.isPending} disabled={!text.trim()}>
            {t('chat.send')}
          </Button>
        </form>
      </aside>
    </>
  );
}
