import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AuthMode, ClaudeStatus } from '@jobhunter/shared';
import type { EngineConfig } from '../config.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * Path of the official Claude Code binary bundled with the Agent SDK (or the user's own `claude`).
 * Jobhunter only runs it; it never reads or stores the credentials it manages.
 */
export function claudeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JOBHUNTER_CLAUDE_PATH) return env.JOBHUNTER_CLAUDE_PATH;
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const candidates = [`@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}`, `@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}-musl`];
  for (const pkg of candidates) {
    try {
      const dir = dirname(require.resolve(`${pkg}/package.json`));
      const bin = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (existsSync(bin)) return bin;
    } catch {
      /* not installed for this platform */
    }
  }
  return 'claude';
}

/** Environment for the Claude Code process, per auth mode. Credentials only ever flow from keychain → child env. */
export function claudeEnv(
  config: EngineConfig,
  mode: AuthMode,
  secrets: { apiKey?: string | null; compatibleKey?: string | null; compatibleBaseUrl?: string | null },
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    // Never leak a key from the parent environment into a different auth mode.
    if (/^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/u.test(k)) continue;
    if (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_USE_BEDROCK') continue;
    env[k] = v;
  }
  if (config.mode === 'server') env.CLAUDE_CONFIG_DIR = join(config.dataDir, 'claude');
  else if (base.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = base.CLAUDE_CONFIG_DIR;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'jobhunter';
  env.DISABLE_TELEMETRY = '1';
  env.DISABLE_AUTOUPDATER = '1';
  if (mode === 'api_key' && secrets.apiKey) env.ANTHROPIC_API_KEY = secrets.apiKey;
  if ((mode === 'compatible' || mode === 'openai_proxy') && secrets.compatibleKey && secrets.compatibleBaseUrl) {
    env.ANTHROPIC_BASE_URL = secrets.compatibleBaseUrl;
    env.ANTHROPIC_AUTH_TOKEN = secrets.compatibleKey;
  }
  return env;
}

interface CliAuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  subscriptionType?: string;
  orgName?: string;
}

/** The official login command to show the user. Jobhunter never runs the login itself. */
export function loginCommand(config: EngineConfig): string {
  if (config.mode === 'server') return 'docker compose exec -it jobhunter claude auth login';
  const bin = claudeExecutable();
  return bin === 'claude' ? 'claude auth login' : `"${bin}" auth login`;
}

/** Ask the official binary whether a Claude login exists (spec §2.1). */
export async function subscriptionStatus(config: EngineConfig, env: Record<string, string>): Promise<ClaudeStatus> {
  const bin = claudeExecutable();
  try {
    const { stdout } = await execFileAsync(bin, ['auth', 'status', '--json'], { env, timeout: 20_000 });
    const s = JSON.parse(stdout) as CliAuthStatus;
    const loggedIn = s.loggedIn === true;
    return {
      mode: 'subscription',
      connected: loggedIn,
      detail: loggedIn ? `Signed in to Claude (${s.authMethod ?? 'oauth'})` : 'Not signed in to Claude',
      account: { email: s.email, subscriptionType: s.subscriptionType, organization: s.orgName },
      loginCommand: loggedIn ? undefined : loginCommand(config),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      mode: 'subscription',
      connected: false,
      detail: /ENOENT/u.test(msg) ? 'Claude Code is not installed' : 'Could not check the Claude login',
      loginCommand: loginCommand(config),
    };
  }
}
