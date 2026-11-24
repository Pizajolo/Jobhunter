// Builds the Electron main process into dist-electron/main.cjs (and the engine + web UI it serves).
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
if (!process.argv.includes('--main-only')) {
  execSync('pnpm --filter @jobhunter/web build', { cwd: repo, stdio: 'inherit' });
  execSync('pnpm --filter @jobhunter/engine build', { cwd: repo, stdio: 'inherit' });
}
await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(root, 'dist-electron/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});
