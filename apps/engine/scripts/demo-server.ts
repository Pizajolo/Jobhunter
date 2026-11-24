/**
 * Starts the engine with synthetic demo data and the offline cassette backend.
 * Used by end-to-end tests and for screenshots:  pnpm --filter @jobhunter/engine demo
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, createLogger, startEngine } from '../src/index.js';
import { seedDemo } from '../src/dev/seed.js';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { eq, jobs } from '@jobhunter/db';

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
  JOBHUNTER_HEADLESS: '1',
});
const log = createLogger({ level: 'warn' });
const engine = await startEngine(config, log);
if (process.env.JOBHUNTER_EMPTY !== '1') seedDemo(engine.ctx);

// Serve the local mock application forms and point one demo job at them, so "Apply with agent" works offline.
const formsDir = join(root, 'fixtures/forms');
const formsServer = http.createServer((req, res) => {
  const file = (req.url ?? '/').split('?')[0]!.slice(1) || 'greenhouse.html';
  try {
    const body = readFileSync(join(formsDir, file));
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise<void>((r) => formsServer.listen(Number(process.env.JOBHUNTER_FORMS_PORT ?? 4410), '127.0.0.1', r));
const formsUrl = `http://127.0.0.1:${(formsServer.address() as AddressInfo).port}`;
engine.ctx.db.update(jobs).set({ applyUrl: `${formsUrl}/greenhouse.html` }).where(eq(jobs.company, 'Lumen Robotics')).run();
console.log(`Demo engine on ${engine.url} (data: ${dataDir})`);
