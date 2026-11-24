import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { BOARD_COLUMNS, COLUMN_DROP_STATUS, columnForStatus, type BoardCard, type BoardColumnId } from '@jobhunter/shared';
import { api, queryClient } from '../lib/api';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { useSummary } from '../components/Layout';
import { formatDateTime } from '../lib/format';

/** Arrow left/right moves a dragged card straight to the neighbouring column (keyboard accessibility). */
const columnJump: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect || (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft')) return undefined;
  event.preventDefault();
  const cols = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const cx = collisionRect.left + collisionRect.width / 2;
  const target = event.code === 'ArrowRight' ? cols.find((r) => r.left > cx) : [...cols].reverse().find((r) => r.left + r.width < cx);
  if (!target) return undefined;
  return { x: target.left + 8, y: target.top + 40 };
};

function useBoard() {
  return useQuery({ queryKey: ['board'], queryFn: () => api.get<BoardCard[]>('/api/board') });
}

function CardTag({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const [code, n] = card.tag.split(':');
  const text = n !== undefined ? t(`board.tag.${code}`, { count: Number(n) }) : t(`board.tag.${code}`);
  return <Badge kind={card.tagKind}>{text}</Badge>;
}

function Card({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.applicationId, data: { card } });
  const closed = columnForStatus(card.status) === 'closed';
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group relative flex flex-col gap-1.5 rounded-[10px] p-3 text-ink',
        closed ? 'border border-dashed border-line-strong bg-ground' : 'border border-line bg-surface hover:border-accent/50',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-ink-2">{card.company}</span>
        {card.score !== null ? <span className="mr-6 text-[11.5px] font-semibold text-accent-ink">{card.score}%</span> : null}
      </div>
      <Link to={`/jobs/${card.applicationId}`} className="text-[13.5px] leading-snug font-semibold text-ink no-underline after:absolute after:inset-0 hover:underline">
        {card.title}
      </Link>
      <span className="text-xs leading-snug text-ink-3">
        {[card.location, t(`remote.${card.remote}`), t(`sources.${card.source}`, { defaultValue: card.source })].filter(Boolean).join(' · ')}
      </span>
      <CardTag card={card} />
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={t('board.move', { title: card.title, company: card.company })}
        className="absolute top-1.5 right-1.5 z-[1] cursor-grab rounded px-1.5 py-0.5 text-ink-3 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
      >
        ⠿
      </button>
    </div>
  );
}

function Column({ id, cards }: { id: BoardColumnId; cards: BoardCard[] }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} aria-label={t(`board.columns.${id}`)} className={clsx('flex min-w-0 flex-col gap-2 rounded-xl bg-sunken p-2.5', isOver && 'ring-2 ring-accent')}>
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="m-0 text-[13px] font-semibold">{t(`board.columns.${id}`)}</h2>
        <span className="text-xs font-medium text-ink-3">{cards.length}</span>
      </div>
      {cards.map((c) => (
        <Card key={c.applicationId} card={c} />
      ))}
    </section>
  );
}

function AddJob({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [f, setF] = useState({ title: '', company: '', url: '', location: '', description: '' });
  const add = useMutation({
    mutationFn: () => api.post<{ applicationId: number }>('/api/jobs/manual', f),
    onSuccess: (r) => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void navigate(`/jobs/${r.applicationId}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('board.addJob')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={add.isPending} disabled={!f.title || !f.company || !f.url} onClick={() => add.mutate()}>
            {t('common.add')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(['title', 'company', 'url', 'location'] as const).map((k) => (
          <Field key={k} id={`addjob-${k}`} label={t(`board.addFields.${k}`)}>
            <Input id={`addjob-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Field id="addjob-description" label={t('board.addFields.description')}>
            <textarea
              id="addjob-description"
              rows={5}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <ErrorText error={add.error} />
    </Modal>
  );
}

export default function Pipeline() {
  const { t, i18n } = useTranslation();
  const board = useBoard();
  const summary = useSummary();
  const [query, setQuery] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [source, setSource] = useState('');
  const [remote, setRemote] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: columnJump }));
  const scan = useMutation({ mutationFn: () => api.post('/api/scan') });
  const status = useQuery({ queryKey: ['scan'], queryFn: () => api.get<{ running: boolean }>('/api/scan/status'), refetchInterval: (q) => (q.state.data?.running || scan.isSuccess ? 3000 : false) });
  const move = useMutation({
    mutationFn: ({ id, status: s }: { id: number; status: string }) => api.patch(`/api/applications/${id}/status`, { status: s }),
    onMutate: async ({ id, status: s }) => {
      await queryClient.cancelQueries({ queryKey: ['board'] });
      const prev = queryClient.getQueryData<BoardCard[]>(['board']);
      queryClient.setQueryData<BoardCard[]>(['board'], (cards) => cards?.map((c) => (c.applicationId === id ? { ...c, status: s as BoardCard['status'] } : c)));
      return { prev };
    },
    onError: (_e, _v, c) => queryClient.setQueryData(['board'], c?.prev),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['board'] }),
  });

  const cards = useMemo(() => board.data ?? [], [board.data]);
  const sourcesList = useMemo(() => [...new Set(cards.map((c) => c.source))].sort(), [cards]);
  const filtered = cards.filter((c) => {
    if (query && !`${c.company} ${c.title} ${c.location}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (minScore && (c.score ?? 0) < minScore) return false;
    if (source && c.source !== source) return false;
    if (remote && c.remote !== remote) return false;
    return true;
  });
  const byCol = new Map<BoardColumnId, BoardCard[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const c of filtered) {
    const col = columnForStatus(c.status);
    if (col) byCol.get(col)!.push(c);
  }

  const onDragEnd = (e: DragEndEvent) => {
    const card = e.active.data.current?.card as BoardCard | undefined;
    const target = e.over?.id as BoardColumnId | undefined;
    if (!card || !target || columnForStatus(card.status) === target) return;
    move.mutate({ id: card.applicationId, status: COLUMN_DROP_STATUS[target] });
  };

  const s = summary.data;
  const scanning = status.data?.running ?? false;
  return (
    <>
      <PageHeader
        title={t('pages.pipeline')}
        subtitle={t('board.subtitle', { count: cards.length })}
        actions={
          <>
            <label htmlFor="board-search" className="sr-only">
              {t('board.search')}
            </label>
            <Input id="board-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('board.search')} className="w-60" />
            <Button aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              {t('board.filters')}
            </Button>
            <Button onClick={() => setAdding(true)}>{t('board.addJob')}</Button>
            <Button variant="primary" busy={scanning} onClick={() => scan.mutate()}>
              {scanning ? t('board.scanning') : t('board.scanNow')}
            </Button>
          </>
        }
      />
      {showFilters ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
          <Field id="f-score" label={t('board.minScore')}>
            <Select id="f-score" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
              {[0, 50, 60, 70, 80, 90].map((n) => (
                <option key={n} value={n}>
                  {n ? `≥ ${n}%` : t('board.any')}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="f-source" label={t('board.source')}>
            <Select id="f-source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{t('board.any')}</option>
              {sourcesList.map((x) => (
                <option key={x} value={x}>
                  {t(`sources.${x}`, { defaultValue: x })}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="f-remote" label={t('board.remote')}>
            <Select id="f-remote" value={remote} onChange={(e) => setRemote(e.target.value)}>
              <option value="">{t('board.any')}</option>
              {(['remote', 'hybrid', 'onsite', 'unknown'] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`remote.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {s ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[10px] border border-line bg-surface px-4 py-3 text-[13px]">
          <span className="text-ink-3">{s.lastScanAt ? t('board.lastScan', { when: formatDateTime(s.lastScanAt, i18n.language) }) : t('board.noScanYet')}</span>
          {s.approvals ? (
            <Link to="/approvals" className="font-medium">
              {t('board.awaitingApproval', { count: s.approvals })}
            </Link>
          ) : null}
          {s.reviewQueue ? (
            <Link to="/review" className="font-medium">
              {t('board.emailsToReview', { count: s.reviewQueue })}
            </Link>
          ) : null}
        </div>
      ) : null}
      <ErrorText error={move.error ?? scan.error} />
      {cards.length === 0 && board.isSuccess ? (
        <EmptyState title={t('board.empty.title')}>
          <p className="m-0">{t('board.empty.body')}</p>
          <p className="m-0 mt-2">
            <Link to="/settings#companies">{t('board.empty.addCompanies')}</Link>
          </p>
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: t('board.dragInstructions') } }}>
          <div className="overflow-x-auto pb-1">
            <div className="grid grid-cols-[repeat(6,minmax(200px,1fr))] items-start gap-3">
              {BOARD_COLUMNS.map((c) => (
                <Column key={c.id} id={c.id} cards={byCol.get(c.id) ?? []} />
              ))}
            </div>
          </div>
        </DndContext>
      )}
      <AddJob open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
