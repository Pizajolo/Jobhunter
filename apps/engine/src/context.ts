import pino, { type Logger } from 'pino';
import { openDb, type Db, type DbHandle } from '@jobhunter/db';
import type { EngineConfig } from './config.js';
import { createSecretStore, MemorySecretStore, type SecretStore } from './secrets/index.js';
import { Bus } from './bus.js';
import type { ClaudeStatus } from '@jobhunter/shared';

export interface AppContext {
  config: EngineConfig;
  dbHandle: DbHandle;
  db: Db;
  secrets: SecretStore;
  log: Logger;
  bus: Bus;
  startedAt: number;
  /** Volatile runtime state shown in the UI (not persisted). */
  runtime: RuntimeState;
}

export interface RuntimeState {
  claude: ClaudeStatus | null;
  nextScanAt: string | null;
  emailConnected: boolean;
}

export async function createContext(config: EngineConfig, log: Logger): Promise<AppContext> {
  const dbHandle = openDb(config.dbPath);
  let secrets: SecretStore = createSecretStore(config.secretsBackend, config.dataDir);
  if (secrets.backend === 'keychain') {
    try {
      await secrets.has('anthropic_api_key');
    } catch (err) {
      // e.g. Linux without a Secret Service: fall back to the encrypted file store
      log.warn({ err: String(err) }, 'OS keychain unavailable, using encrypted secrets file');
      secrets = createSecretStore('file', config.dataDir);
    }
  }
  return { config, dbHandle, db: dbHandle.db, secrets, log, bus: new Bus(), startedAt: Date.now(), runtime: newRuntime() };
}

export function createTestContext(overrides: Partial<EngineConfig> = {}, log?: Logger): AppContext {
  const dbHandle = openDb(':memory:');
  const config: EngineConfig = {
    mode: 'dev',
    dataDir: overrides.dataDir ?? '/tmp/jobhunter-test',
    dbPath: ':memory:',
    filesDir: '/tmp/jobhunter-test/files',
    browserProfileDir: '/tmp/jobhunter-test/browser',
    host: '127.0.0.1',
    port: 0,
    webDistDir: null,
    requireLogin: false,
    logLevel: 'silent',
    secretsBackend: 'memory',
    headlessBrowser: true,
    ...overrides,
  };
  return {
    config,
    dbHandle,
    db: dbHandle.db,
    secrets: new MemorySecretStore(),
    log: log ?? pino({ level: 'silent' }),
    bus: new Bus(),
    startedAt: Date.now(),
    runtime: newRuntime(),
  };
}

function newRuntime(): RuntimeState {
  return { claude: null, nextScanAt: null, emailConnected: false };
}
