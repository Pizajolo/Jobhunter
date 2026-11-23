/** A small structural diff used to show proposed changes for confirmation (spec §5.1, §5.2). */
export interface DiffEntry {
  path: string;
  op: 'add' | 'remove' | 'change';
  before?: unknown;
  after?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function diffValues(before: unknown, after: unknown, path = ''): DiffEntry[] {
  if (Array.isArray(before) && Array.isArray(after) && before.every((x) => typeof x !== 'object')) {
    const out: DiffEntry[] = [];
    const b = new Set(before.map((x) => JSON.stringify(x)));
    const a = new Set(after.map((x) => JSON.stringify(x)));
    for (const x of after) if (!b.has(JSON.stringify(x))) out.push({ path, op: 'add', after: x });
    for (const x of before) if (!a.has(JSON.stringify(x))) out.push({ path, op: 'remove', before: x });
    return out;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((k) => diffValues(before[k], after[k], path ? `${path}.${k}` : k));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before === undefined) return [{ path, op: 'add', after }];
  if (after === undefined) return [{ path, op: 'remove', before }];
  return [{ path, op: 'change', before, after }];
}
