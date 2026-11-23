import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createContext } from '../context.js';
import { createSilentLogger } from '../logger.js';
import { runTask } from './runner.js';
import { TASKS } from '../tasks/index.js';
import type { Cassette } from './cassette.js';
import { updateSettings } from '@jobhunter/db';

/**
 * Live mode for the prompt harness: runs each case against the real model with a throwaway
 * database. Uses your normal Claude login (or JOBHUNTER_AUTH_MODE=api_key + ANTHROPIC_API_KEY).
 */
export async function createLiveRunner(): Promise<(task: string, c: Cassette) => Promise<unknown>> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jobhunter-live-'));
  const config = { ...loadConfig({ ...process.env, JOBHUNTER_DATA_DIR: dataDir, JOBHUNTER_SECRETS: 'memory' }) };
  const ctx = await createContext(config, createSilentLogger());
  const mode = process.env.JOBHUNTER_AUTH_MODE === 'api_key' ? 'api_key' : 'subscription';
  updateSettings(ctx.db, { auth: { mode } });
  if (mode === 'api_key' && process.env.ANTHROPIC_API_KEY) await ctx.secrets.set('anthropic_api_key', process.env.ANTHROPIC_API_KEY);
  return async (task, c) => {
    const def = TASKS[task];
    if (!def) throw new Error(`Unknown task ${task}`);
    const r = await runTask(ctx, def, c.input, { vars: c.vars });
    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
    return r.output;
  };
}
