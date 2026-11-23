import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PromptFile {
  name: string;
  version: number;
  meta: Record<string, string>;
  body: string;
}

export function promptsDir(): string {
  if (process.env.JOBHUNTER_PROMPTS_DIR) return process.env.JOBHUNTER_PROMPTS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../prompts'), resolve(here, 'prompts'), resolve(here, '../prompts')];
  return candidates.find((c) => existsSync(join(c, '_partials'))) ?? candidates[0]!;
}

const cache = new Map<string, PromptFile>();

export function parsePromptFile(name: string, text: string): PromptFile {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text);
  if (!m) throw new Error(`Prompt ${name} has no front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/u.exec(line.trim());
    if (kv) meta[kv[1]!] = kv[2]!;
  }
  const version = Number(meta.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`Prompt ${name} needs an integer version`);
  return { name, version, meta, body: m[2]! };
}

export function loadPrompt(name: string, dir = promptsDir()): PromptFile {
  const key = `${dir}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = parsePromptFile(name, readFileSync(join(dir, `${name}.md`), 'utf8'));
  cache.set(key, file);
  return file;
}

export function listPrompts(dir = promptsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

/**
 * Render a prompt: `{{> partial}}` includes files from prompts/_partials, `{{name}}` substitutes
 * variables. Unknown placeholders are an error, so a typo can never ship a half-rendered prompt.
 */
export function renderPrompt(name: string, vars: Record<string, string>, dir = promptsDir()): { text: string; version: number } {
  const file = loadPrompt(name, dir);
  let text = file.body.replace(/\{\{>\s*([a-z_]+)\s*\}\}/gu, (_m, partial: string) =>
    readFileSync(join(dir, '_partials', `${partial}.md`), 'utf8').trim(),
  );
  const missing: string[] = [];
  text = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gu, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      missing.push(key);
      return '';
    }
    return v;
  });
  if (missing.length) throw new Error(`Prompt ${name} is missing variables: ${[...new Set(missing)].join(', ')}`);
  return { text: text.trim(), version: file.version };
}
