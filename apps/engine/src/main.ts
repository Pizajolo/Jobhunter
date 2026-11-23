import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { startEngine } from './index.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, dataDir: config.dataDir, pretty: config.mode === 'dev' });

startEngine(config, log).catch((err: unknown) => {
  log.fatal({ err }, 'engine failed to start');
  process.exit(1);
});
