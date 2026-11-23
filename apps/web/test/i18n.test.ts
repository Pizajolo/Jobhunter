import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const localesDir = join(import.meta.dirname, '../src/i18n/locales');
const srcDir = join(import.meta.dirname, '../src');

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
function load(lang: string): string[] {
  return flatten(JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8')) as Record<string, unknown>).sort();
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/u.test(f) ? [p] : [];
  });
}

describe('i18n', () => {
  const en = load('en');
  for (const lang of ['de', 'pt', 'es', 'fr']) {
    it(`${lang} has exactly the English keys`, () => {
      const other = load(lang);
      expect(en.filter((k) => !other.includes(k)), `missing in ${lang}`).toEqual([]);
      expect(other.filter((k) => !en.includes(k)), `extra in ${lang}`).toEqual([]);
    });
  }

  it('every static t() key used in the UI exists in English', () => {
    const used = new Set<string>();
    for (const file of walk(srcDir)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/gu)) used.add(m[1]!);
    }
    // keys with plural suffixes (_one/_other) are resolved by i18next
    const enSet = new Set(en.map((k) => k.replace(/_(one|other)$/u, '')));
    expect([...used].filter((k) => !enSet.has(k)).sort()).toEqual([]);
  });
});
