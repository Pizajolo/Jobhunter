import { SettingsSchema, type Settings } from '@jobhunter/shared';
import type { Db } from '../client.js';
import { settings } from '../schema.js';
import { sql } from 'drizzle-orm';

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Settings are stored as key/value rows (one row per top-level key) and validated on read and write. */
export function getSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = r.value;
  const parsed = SettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A corrupt key should not brick the app: drop invalid keys and fall back to defaults for them.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SettingsSchema.safeParse({ [k]: v }).success) cleaned[k] = v;
  }
  return SettingsSchema.parse(cleaned);
}

export function updateSettings(db: Db, patch: SettingsPatch): Settings {
  const current = getSettings(db);
  const merged = SettingsSchema.parse(deepMerge(current, patch));
  db.transaction((tx) => {
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const value = merged[key];
      tx.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` } })
        .run();
    }
  });
  return merged;
}
