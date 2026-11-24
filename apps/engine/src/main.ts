import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { startEngine } from './index.js';

const config = loadConfig();

if (process.argv[2] === 'mcp') {
  // `main.js mcp [--allow-writes]`: the pipeline as an MCP server over stdio, for Claude Desktop,
  // Claude Code or any other MCP client. stdout carries the protocol, so nothing else is printed.
  const { runStdioServer } = await import('@jobhunter/mcp-pipeline');
  await runStdioServer(config.dbPath, { allowWrites: process.argv.includes('--allow-writes') }).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  const log = createLogger({ level: config.logLevel, dataDir: config.dataDir, pretty: config.mode === 'dev' });
  startEngine(config, log).catch((err: unknown) => {
    log.fatal({ err }, 'engine failed to start');
    process.exit(1);
  });
}
