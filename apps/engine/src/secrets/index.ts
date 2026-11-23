import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_ID } from '@jobhunter/shared';

/** Names of every secret the app may hold. Nothing else is ever stored. */
export const SECRET_KEYS = [
  'anthropic_api_key',
  'compatible_api_key',
  'gmail_oauth_client_secret',
  'gmail_refresh_token',
  'imap_app_password',
  'vapid_private_key',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export interface SecretStore {
  readonly backend: string;
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
  has(key: SecretKey): Promise<boolean>;
}

export class MemorySecretStore implements SecretStore {
  readonly backend = 'memory';
  private readonly map = new Map<SecretKey, string>();
  async get(key: SecretKey) {
    return this.map.get(key) ?? null;
  }
  async set(key: SecretKey, value: string) {
    this.map.set(key, value);
  }
  async delete(key: SecretKey) {
    this.map.delete(key);
  }
  async has(key: SecretKey) {
    return this.map.has(key);
  }
}

/** OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux). */
export class KeychainSecretStore implements SecretStore {
  readonly backend = 'keychain';
  private async entry(key: SecretKey) {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(APP_ID, key);
  }
  async get(key: SecretKey) {
    return (await this.entry(key)).getPassword();
  }
  async set(key: SecretKey, value: string) {
    (await this.entry(key)).setPassword(value);
  }
  async delete(key: SecretKey) {
    try {
      (await this.entry(key)).deletePassword();
    } catch {
      /* not present */
    }
  }
  async has(key: SecretKey) {
    return (await this.get(key)) !== null;
  }
}

interface EncryptedFile {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/**
 * AES-256-GCM encrypted JSON file for server mode (spec §2.7). The key is derived with scrypt
 * from a master key that should come from an env var or Docker secret, not from the data volume.
 */
export class EncryptedFileSecretStore implements SecretStore {
  readonly backend = 'file';
  constructor(
    private readonly path: string,
    private readonly masterKey: string,
  ) {
    if (masterKey.length < 16) throw new Error('Master key must be at least 16 characters');
  }

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    const f = JSON.parse(readFileSync(this.path, 'utf8')) as EncryptedFile;
    const key = scryptSync(this.masterKey, Buffer.from(f.salt, 'base64'), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(f.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(f.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as Record<string, string>;
  }

  private write(values: Record<string, string>): void {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.masterKey, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
    const file: EncryptedFile = {
      v: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* best effort on Windows */
    }
  }

  async get(key: SecretKey) {
    return this.read()[key] ?? null;
  }
  async set(key: SecretKey, value: string) {
    const all = this.read();
    all[key] = value;
    this.write(all);
  }
  async delete(key: SecretKey) {
    const all = this.read();
    if (key in all) this.write(Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
  }
  async has(key: SecretKey) {
    return key in this.read();
  }
}

/** Resolve the master key for the file backend: env var, then a key file, then a generated local key. */
export function resolveMasterKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): { key: string; source: string } {
  if (env.JOBHUNTER_MASTER_KEY) return { key: env.JOBHUNTER_MASTER_KEY, source: 'env' };
  if (env.JOBHUNTER_MASTER_KEY_FILE && existsSync(env.JOBHUNTER_MASTER_KEY_FILE)) {
    return { key: readFileSync(env.JOBHUNTER_MASTER_KEY_FILE, 'utf8').trim(), source: 'file' };
  }
  const local = join(dataDir, 'master.key');
  if (!existsSync(local)) writeFileSync(local, randomBytes(32).toString('base64'), { mode: 0o600 });
  return { key: readFileSync(local, 'utf8').trim(), source: 'generated' };
}

export function createSecretStore(
  backend: 'keychain' | 'file' | 'memory',
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): SecretStore {
  if (backend === 'memory') return new MemorySecretStore();
  if (backend === 'keychain') return new KeychainSecretStore();
  return new EncryptedFileSecretStore(join(dataDir, 'secrets.enc'), resolveMasterKey(dataDir, env).key);
}
