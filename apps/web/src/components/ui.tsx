import clsx from 'clsx';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { DiffEntry } from '@jobhunter/shared';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }
>(function Button({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent font-semibold text-on-accent hover:opacity-90',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken',
        variant === 'danger' && 'border border-line-strong bg-surface text-bad-ink hover:bg-bad-soft',
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
});

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        small ? 'h-3.5 w-3.5' : 'h-5 w-5',
      )}
    />
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-5', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="m-0 text-[15px] font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type BadgeKind = 'new' | 'info' | 'warn' | 'muted' | 'ok' | 'bad';
export function Badge({ kind = 'muted', children, className }: { kind?: BadgeKind; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center self-start rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        (kind === 'new' || kind === 'info') && 'bg-accent-soft text-accent-ink',
        kind === 'warn' && 'bg-warn-soft text-warn-ink',
        kind === 'muted' && 'bg-muted-soft text-ink-2',
        kind === 'ok' && 'bg-ok-soft text-ok-ink',
        kind === 'bad' && 'bg-bad-soft text-bad-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="m-0 text-[13.5px] text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm">
      <p className="m-0 font-semibold">{title}</p>
      {children ? <div className="text-ink-3">{children}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 text-[12.5px] text-ink-3">{hint}</p> : null}
      {error ? (
        <p role="alert" className="m-0 text-[12.5px] text-bad-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputCls, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={clsx(inputCls, 'py-2 leading-relaxed', className)} {...rest} />;
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(inputCls, 'h-10', className)} {...rest} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description ? <span className="text-[12.5px] text-ink-3">{description}</span> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')}
        />
      </button>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-sunken p-[3px]">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
            onChange(tabs[next]!.id);
            refs.current[next]?.focus();
          }}
          className={clsx(
            'rounded-md px-3 py-1.5 text-[13px]',
            tab.id === value ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <div className="max-h-[65vh] overflow-y-auto">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </dialog>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Shows a proposed change as a diff for confirmation (spec §5.1 step 6, §5.2, §5.7.9). */
export function DiffView({ diff }: { diff: DiffEntry[] }) {
  const { t } = useTranslation();
  if (diff.length === 0) return <p className="m-0 text-sm text-ink-3">{t('diff.none')}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
      {diff.map((d, i) => (
        <li key={i} className="rounded-md border border-line bg-ground px-3 py-2">
          <span className="font-medium">{d.path}</span>{' '}
          {d.op === 'add' ? (
            <span className="text-ok-ink">+ {show(d.after)}</span>
          ) : d.op === 'remove' ? (
            <span className="text-bad-ink line-through">− {show(d.before)}</span>
          ) : (
            <span>
              <span className="text-bad-ink line-through">{show(d.before)}</span> → <span className="text-ok-ink">{show(d.after)}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="m-0 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">
      {msg}
    </p>
  );
}
