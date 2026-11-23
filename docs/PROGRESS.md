# Progress

Updated at the end of every milestone. See `PLAN.md` for the plan and decisions.

| Milestone | Status |
|---|---|
| M0 Skeleton | done |
| M1 Claude + agent layer | not started |
| M2 Profile | not started |
| M3 Scanning | not started |
| M4 Documents | not started |
| M5 Email | not started |
| M6 Applying | not started |
| M7 Packaging | not started |
| M8 Extras + polish | not started |

## M0 Skeleton

**Done**
- pnpm workspace (`apps/engine`, `apps/web`, `apps/desktop`, `packages/*`), TypeScript strict (+ `noUncheckedIndexedAccess`), ESLint (typescript-eslint strict, no `any`), Prettier, Vitest.
- `packages/shared`: settings schema with the spec §8 defaults, application status machine, domain schemas (profile, facts, style, search profile, jobs, matches, emails, documents), text normalisation and similarity helpers, structural diff.
- `packages/db`: Drizzle schema for every spec §4 table plus task runs, HTTP cache, domain budget, scan runs, apply runs, notifications, auth sessions; initial SQL migration; settings and events repositories.
- `apps/engine`: config (desktop / server / dev), pino logging with key redaction and secret scrubbing, secrets store (OS keychain, AES-256-GCM file, memory), Fastify server with `/api/health`, settings, notifications, summary, WebSocket invalidation hub, static web UI with SPA fallback, esbuild bundle with a check for undeclared runtime dependencies.
- `apps/web`: React 19 + Vite + Tailwind v4 shell with the mockup's design tokens (light + dark), sidebar navigation, routes for all screens, chat panel, notifications, i18n (EN, DE, PT, ES, FR) with a key-parity test.
- GitHub Actions CI (lint, typecheck, tests, prompt tests, build, e2e).

**Known issues**
- Screens are placeholders until their milestones.
