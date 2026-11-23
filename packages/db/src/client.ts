import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  path: string;
  close(): void;
}

/** Location of the SQL migrations. Overridable for bundled builds (Electron, Docker). */
export function defaultMigrationsFolder(): string {
  const fromEnv = process.env.JOBHUNTER_MIGRATIONS_DIR;
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../migrations'), resolve(here, 'migrations'), resolve(here, '../../migrations')];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

export function openDb(path: string, opts: { migrationsFolder?: string; migrate?: boolean } = {}): DbHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  if (opts.migrate !== false) {
    migrate(db, { migrationsFolder: opts.migrationsFolder ?? defaultMigrationsFolder() });
  }
  return { db, sqlite, path, close: () => sqlite.close() };
}

/** Fresh migrated in-memory database for tests. */
export function openTestDb(): DbHandle {
  return openDb(':memory:');
}
