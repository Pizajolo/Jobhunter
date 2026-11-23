// Bundles the engine (and the workspace packages it uses) into dist/main.js.
// Third-party packages stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const externalThirdParty = {
  name: 'external-third-party',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@jobhunter/')) return undefined;
      if (args.path.startsWith('node:')) return { path: args.path, external: true };
      return { path: args.path, external: true };
    });
  },
};

const result = await build({
  metafile: true,
  entryPoints: { main: join(root, 'src/main.ts') },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externalThirdParty],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

// Every external import must be a declared dependency of the engine, or the bundle breaks at runtime.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const missing = new Set();
for (const out of Object.values(result.metafile.outputs)) {
  for (const imp of out.imports) {
    if (!imp.external || imp.path.startsWith('node:') || builtinModules.includes(imp.path)) continue;
    const name = imp.path.startsWith('@') ? imp.path.split('/').slice(0, 2).join('/') : imp.path.split('/')[0];
    if (!declared.has(name)) missing.add(name);
  }
}
if (missing.size) {
  console.error(`Engine bundle imports undeclared packages: ${[...missing].join(', ')}. Add them to apps/engine/package.json.`);
  process.exit(1);
}

for (const [from, to] of [
  ['../../packages/db/migrations', 'migrations'],
  ['prompts', 'prompts'],
  ['../../packages/mcp-docs/templates', 'templates'],
]) {
  const src = join(root, from);
  if (existsSync(src)) cpSync(src, join(dist, to), { recursive: true });
}
