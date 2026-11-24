import clsx from 'clsx';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { Button, DiffView, ErrorText, Textarea } from '../../components/ui';
import type { ChatMessage } from '../../components/ChatPanel';

/** Inline chat thread (used for "Tell me what you're looking for"). Changes are confirmed as diffs. */
export function ChatPanelInline({ thread, placeholder }: { thread: string; placeholder: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const messages = useQuery({ queryKey: ['chat', thread], queryFn: () => api.get<ChatMessage[]>(`/api/chat?thread=${thread}`) });
  const send = useMutation({
    mutationFn: (content: string) => api.post('/api/chat', { thread, content }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['chat', thread] });
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'apply' | 'reject' }) => api.post(`/api/chat/proposals/${id}/${action}`),
    onSuccess: () => void queryClient.invalidateQueries(),
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-ground p-3">
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto" aria-live="polite">
        {messages.data?.map((m) => (
          <div key={m.id} className={clsx('flex max-w-[92%] flex-col gap-2 rounded-lg px-3 py-2 text-[13.5px] whitespace-pre-wrap', m.role === 'user' ? 'self-end bg-accent-soft' : 'self-start bg-surface')}>
            <span>{m.content}</span>
            {m.proposal ? (
              <div className="flex flex-col gap-2">
                <DiffView diff={m.proposal.diff} />
                {m.proposalStatus === 'pending' ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: m.id, action: 'apply' })}>
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
        {send.isPending ? <span className="text-[13px] text-ink-3">{t('chat.thinking')}</span> : null}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate(text.trim());
        }}
      >
        <label htmlFor={`chat-${thread}`} className="sr-only">
          {placeholder}
        </label>
        <Textarea id={`chat-${thread}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
        <Button type="submit" variant="primary" busy={send.isPending} disabled={!text.trim()}>
          {t('chat.send')}
        </Button>
      </form>
      <ErrorText error={send.error ?? decide.error} />
    </div>
  );
}
