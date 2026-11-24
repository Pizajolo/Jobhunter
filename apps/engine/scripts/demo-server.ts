/**
 * Starts the engine with synthetic demo data and the offline cassette backend.
 * Used by end-to-end tests and for screenshots:  pnpm --filter @jobhunter/engine demo
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, createLogger, startEngine } from '../src/index.js';
import { seedDemo } from '../src/dev/seed.js';

const root = resolve(import.meta.dirname, '../../..');
process.env.JOBHUNTER_FAKE_LLM = '1';
process.env.JOBHUNTER_FIXTURES_DIR ??= join(root, 'fixtures');
process.env.JOBHUNTER_DISABLE_SCHEDULER = '1';
const dataDir = process.env.JOBHUNTER_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'jobhunter-demo-'));
const config = loadConfig({
  ...process.env,
  JOBHUNTER_DATA_DIR: dataDir,
  JOBHUNTER_SECRETS: 'memory',
  JOBHUNTER_WEB_DIST: process.env.JOBHUNTER_WEB_DIST ?? join(root, 'apps/web/dist'),
  JOBHUNTER_PORT: process.env.JOBHUNTER_PORT ?? '4400',
});
const log = createLogger({ level: 'warn' });
const engine = await startEngine(config, log);
if (process.env.JOBHUNTER_EMPTY !== '1') seedDemo(engine.ctx);
console.log(`Demo engine on ${engine.url} (data: ${dataDir})`);
