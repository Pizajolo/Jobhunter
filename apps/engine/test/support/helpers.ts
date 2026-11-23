import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestContext, type AppContext } from '../../src/context.js';
import { FakeBackend } from '../../src/agent/backends/fake.js';
import { setBackendOverride } from '../../src/agent/runner.js';
import { buildApp } from '../../src/server/app.js';

export const FIXTURES = join(import.meta.dirname, '../../../../fixtures');

export function fixture(path: string): Buffer {
  return readFileSync(join(FIXTURES, path));
}

export function fixtureJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T;
}

export async function testApp(overrides: Parameters<typeof createTestContext>[0] = {}) {
  const ctx = createTestContext(overrides);
  const fake = new FakeBackend();
  setBackendOverride(ctx, fake);
  const app = await buildApp(ctx);
  return { ctx, fake, app };
}

export async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export type { AppContext };
