/** Recorded model outputs used by the prompt harness and evals (spec §6). */
export interface Assertion {
  path: string;
  equals?: unknown;
  gte?: number;
  lte?: number;
  includes?: string;
  notIncludes?: string;
  minLength?: number;
  maxLength?: number;
}

export interface Cassette {
  description?: string;
  input: unknown;
  vars?: Record<string, string>;
  output: unknown;
  assert?: Assertion[];
}

export function getPath(obj: unknown, path: string): unknown {
  if (path === '' || path === '.') return obj;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/u.test(key)) return acc[Number(key)];
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function checkAssertions(output: unknown, assertions: Assertion[]): string[] {
  const out: string[] = [];
  for (const a of assertions) {
    const v = getPath(output, a.path);
    const text = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    if (a.equals !== undefined && JSON.stringify(v) !== JSON.stringify(a.equals)) out.push(`${a.path} = ${JSON.stringify(v)}, expected ${JSON.stringify(a.equals)}`);
    if (a.gte !== undefined && !(typeof v === 'number' && v >= a.gte)) out.push(`${a.path} = ${String(v)}, expected >= ${a.gte}`);
    if (a.lte !== undefined && !(typeof v === 'number' && v <= a.lte)) out.push(`${a.path} = ${String(v)}, expected <= ${a.lte}`);
    if (a.includes !== undefined && !text.toLowerCase().includes(a.includes.toLowerCase())) out.push(`${a.path} should include "${a.includes}"`);
    if (a.notIncludes !== undefined && text.toLowerCase().includes(a.notIncludes.toLowerCase())) out.push(`${a.path} must not include "${a.notIncludes}"`);
    const len = Array.isArray(v) ? v.length : typeof v === 'string' ? v.length : 0;
    if (a.minLength !== undefined && len < a.minLength) out.push(`${a.path} length ${len} < ${a.minLength}`);
    if (a.maxLength !== undefined && len > a.maxLength) out.push(`${a.path} length ${len} > ${a.maxLength}`);
  }
  return out;
}
