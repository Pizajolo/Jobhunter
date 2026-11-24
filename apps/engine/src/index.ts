import type { Logger } from 'pino';
import type { EngineConfig } from './config.js';
import { createContext, type AppContext } from './context.js';
import { buildApp } from './server/app.js';
import { startServices, stopServices } from './services.js';

export { loadConfig } from './config.js';
export { createLogger } from './logger.js';

export interface RunningEngine {
  ctx: AppContext;
  url: string;
  stop(): Promise<void>;
}

export async function startEngine(config: EngineConfig, log: Logger): Promise<RunningEngine> {
  const ctx = await createContext(config, log);
  if (process.env.JOBHUNTER_FAKE_LLM === '1') {
    const { createCassetteBackend } = await import('./dev/fake-llm.js');
    const { setBackendOverride } = await import('./agent/runner.js');
    setBackendOverride(ctx, createCassetteBackend(process.env.JOBHUNTER_FIXTURES_DIR ?? `${process.cwd()}/fixtures`));
    log.warn('JOBHUNTER_FAKE_LLM=1: using recorded answers, no real model calls');
  }
  const app = await buildApp(ctx);
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://${config.host}:${port}`;
  await startServices(ctx);
  log.info({ url, mode: config.mode, dataDir: config.dataDir }, 'Jobhunter engine started');
  connectParent(ctx, url);
  const stop = async () => {
    await stopServices(ctx);
    await app.close();
    ctx.dbHandle.close();
  };
  const onSignal = () => {
    void stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return { ctx, url, stop };
}

interface ParentPort {
  postMessage(m: unknown): void;
  on(event: 'message', fn: (e: { data: { type?: string } }) => void): void;
}

/**
 * When the desktop shell (Electron utilityProcess) started us: report readiness, forward
 * notifications to OS notifications, and run a catch-up check when the laptop wakes up.
 */
function connectParent(ctx: AppContext, url: string): void {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  const send = (m: unknown) => (port ? port.postMessage(m) : process.send?.(m));
  if (!port && !process.send) return;
  send({ type: 'ready', url });
  ctx.bus.on<{ title: string; body: string; urgent?: boolean; link?: string | null }>('notification', (n) => send({ type: 'notification', title: n.title, body: n.body, urgent: n.urgent ?? false, link: n.link ?? null }));
  port?.on('message', (e) => {
    if (e.data.type === 'resume') ctx.bus.emit('system:resume', null);
  });
}
