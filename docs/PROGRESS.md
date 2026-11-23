# Progress

Updated at the end of every milestone. See `PLAN.md` for the plan and decisions.

| Milestone | Status |
|---|---|
| M0 Skeleton | done |
| M1 Claude + agent layer | done |
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

## M1 Claude + agent layer

**Done**
- Claude subscription as the default: login detection by asking the bundled official Claude Code binary (`claude auth status --json`); the UI shows the official login command and a "Check again" button. No credentials are read or stored. In server mode the login lives in the data volume (`CLAUDE_CONFIG_DIR=/data/claude`).
- API key (OS keychain / encrypted file), Anthropic-compatible endpoints (base URL + key), OpenAI-via-proxy marked experimental.
- `runTask()` (the `AgentRunner`): routes each task to its model, renders the versioned prompt with the output JSON Schema, validates with Zod, runs deterministic checks, retries once with the errors, records tokens and estimated cost in `task_runs`, failures visible in Diagnostics.
- Two backends: Agent SDK (built-in tools disabled, only Jobhunter MCP tools / web tools, `settingSources: []`, `permissionMode: dontAsk`) for everything in subscription mode and for agent loops; Messages API with structured outputs and server-side refusal fallback for single-shot tasks in API-key mode. Small tasks are batched.
- Monthly budget gate: non-essential tasks pause with a single notification.
- Prompt files with front matter, partials (shared truthfulness rules) and strict placeholders; `pnpm test:prompts` (replay by default, `--live` / `--record` locally).
- Settings UI: language, Claude account, model routing per tier and per task, budget. Diagnostics page (task runs, failures, source health, log download).
- **Agent SDK end-to-end test**: the real Claude Code binary runs against a local fake Messages API, so structured output, disabled built-in tools and MCP tool calls are verified in CI without network access or credentials.

**Known issues / not verified**
- Live model calls were not made in this environment (no account); run `pnpm test:prompts --live` locally.
- The structured-output JSON Schema conversion drops numeric/length constraints (Zod still enforces them after the answer).
