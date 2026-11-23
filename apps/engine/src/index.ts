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
  const app = await buildApp(ctx);
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://${config.host}:${port}`;
  await startServices(ctx);
  log.info({ url, mode: config.mode, dataDir: config.dataDir }, 'Jobhunter engine started');
  // Signal readiness to a parent process (Electron) when spawned as a child.
  process.send?.({ type: 'ready', url });
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
