import pino, { type Logger } from 'pino';
import { join } from 'node:path';

/** Keys whose values are never logged (spec §2.7, §7). */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'body',
  '*.body',
  'appPassword',
  '*.appPassword',
];

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/gu,
  /sk-[A-Za-z0-9]{20,}/gu,
  /ya29\.[A-Za-z0-9._-]{10,}/gu, // Google access tokens
  /1\/\/[A-Za-z0-9._-]{20,}/gu, // Google refresh tokens
  /Bearer\s+[A-Za-z0-9._~+/-]{10,}=*/gu,
  /\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/gu, // Gmail app passwords
];

/** Remove anything that looks like a credential from free text before it reaches a log or the UI. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

export function createLogger(opts: { level: string; dataDir?: string; pretty?: boolean }): Logger {
  const targets: pino.TransportTargetOptions[] = [];
  if (opts.pretty) targets.push({ target: 'pino-pretty', level: opts.level, options: { colorize: true } });
  else targets.push({ target: 'pino/file', level: opts.level, options: { destination: 1 } });
  if (opts.dataDir) {
    targets.push({
      target: 'pino/file',
      level: opts.level,
      options: { destination: join(opts.dataDir, 'logs', 'engine.log'), mkdir: true },
    });
  }
  return pino(
    {
      level: opts.level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a)) as Parameters<typeof method>;
          method.apply(this, scrubbed);
        },
      },
    },
    pino.transport({ targets }),
  );
}

export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
