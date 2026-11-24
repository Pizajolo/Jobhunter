import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { APP_ID } from '@jobhunter/shared';

export type RunMode = 'desktop' | 'server' | 'dev';

export interface EngineConfig {
  mode: RunMode;
  dataDir: string;
  dbPath: string;
  filesDir: string;
  browserProfileDir: string;
  host: string;
  port: number;
  webDistDir: string | null;
  /** Server mode only: require a login for the web UI. */
  requireLogin: boolean;
  logLevel: string;
  secretsBackend: 'keychain' | 'file' | 'memory';
  headlessBrowser: boolean;
}

/** Data folder shared by the desktop app, the dev engine and `main.js mcp` (so they all find the same database). */
export function defaultDataDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Jobhunter', 'data');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Jobhunter', 'data');
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_ID);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const mode = (env.JOBHUNTER_MODE as RunMode | undefined) ?? 'dev';
  if (!['desktop', 'server', 'dev'].includes(mode)) throw new Error(`Invalid JOBHUNTER_MODE: ${mode}`);
  const dataDir = resolve(env.JOBHUNTER_DATA_DIR ?? defaultDataDir());
  const filesDir = join(dataDir, 'files');
  const browserProfileDir = join(dataDir, 'browser-profile');
  for (const d of [dataDir, filesDir, browserProfileDir]) mkdirSync(d, { recursive: true });
  const secretsBackend =
    (env.JOBHUNTER_SECRETS as EngineConfig['secretsBackend'] | undefined) ?? (mode === 'server' ? 'file' : 'keychain');
  return {
    mode,
    dataDir,
    dbPath: join(dataDir, 'jobhunter.sqlite'),
    filesDir,
    browserProfileDir,
    host: env.JOBHUNTER_HOST ?? '127.0.0.1',
    port: Number(env.JOBHUNTER_PORT ?? 4317),
    webDistDir: env.JOBHUNTER_WEB_DIST ?? null,
    requireLogin: mode === 'server' && env.JOBHUNTER_DISABLE_LOGIN !== '1',
    logLevel: env.JOBHUNTER_LOG_LEVEL ?? (mode === 'dev' ? 'debug' : 'info'),
    secretsBackend,
    headlessBrowser: mode === 'server' || env.JOBHUNTER_HEADLESS === '1',
  };
}
