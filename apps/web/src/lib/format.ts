export function formatDate(
  iso: string | null | undefined,
  lang: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang, opts).format(d);
}

export function formatDateTime(iso: string | null | undefined, lang: string): string {
  return formatDate(iso, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}
