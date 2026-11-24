// Packages the desktop app with electron-builder.
//   node scripts/package.mjs            installers for the current OS (dmg / nsis / AppImage + deb)
//   node scripts/package.mjs --dir      unpacked app only (fast, used for smoke tests)
// The app is staged in a flat npm folder so electron-builder can rebuild native modules
// (better-sqlite3, keyring, argon2) for Electron.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const stage = join(root, 'stage');
const enginePkg = JSON.parse(readFileSync(join(repo, 'apps/engine/package.json'), 'utf8'));
const desktopPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const deps = Object.fromEntries(Object.entries(enginePkg.dependencies).filter(([name]) => !name.startsWith('@jobhunter/')));
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'jobhunter',
      productName: 'Jobhunter',
      version: desktopPkg.version,
      description: 'Local-first AI job-search assistant',
      author: 'Jobhunter contributors',
      license: 'MIT',
      repository: 'https://github.com/Pizajolo/Jobhunter',
      main: 'main.cjs',
      dependencies: deps,
    },
    null,
    2,
  ),
);
cpSync(join(root, 'dist-electron/main.cjs'), join(stage, 'main.cjs'));
cpSync(join(repo, 'apps/engine/dist'), join(stage, 'engine'), { recursive: true });
writeFileSync(join(stage, 'engine/package.json'), JSON.stringify({ type: 'module' }));
cpSync(join(repo, 'apps/web/dist'), join(stage, 'web'), { recursive: true });
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });

const dirOnly = process.argv.includes('--dir');
const config = {
  appId: 'io.github.pizajolo.jobhunter',
  productName: 'Jobhunter',
  directories: { app: stage, output: join(root, 'release'), buildResources: join(root, 'build') },
  files: ['**/*', '!**/*.map'],
  // No asar: the engine is a separate Node process that loads native modules and spawns bundled
  // binaries (Claude Code, Playwright), which all need real files on disk.
  asar: false,
  extraResources: [{ from: join(root, 'build/icon.png'), to: 'icon.png' }],
  npmRebuild: true,
  mac: { category: 'public.app-category.productivity', target: dirOnly ? 'dir' : ['dmg', 'zip'], icon: join(root, 'build/icon.png') },
  win: { target: dirOnly ? 'dir' : ['nsis'], icon: join(root, 'build/icon.png') },
  linux: { target: dirOnly ? 'dir' : ['AppImage', 'deb'], category: 'Office', icon: join(root, 'build/icon.png'), maintainer: 'Jobhunter contributors' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
};
writeFileSync(join(root, 'electron-builder.generated.json'), JSON.stringify(config, null, 2));
if (!existsSync(join(root, 'build/icon.png'))) throw new Error('build/icon.png missing');
execSync(`npx electron-builder --config electron-builder.generated.json ${dirOnly ? '--dir' : ''} --publish never`, { cwd: root, stdio: 'inherit' });
