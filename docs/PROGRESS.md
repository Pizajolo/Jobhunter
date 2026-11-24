# Progress

Updated at the end of every milestone. See `PLAN.md` for the plan and decisions.

| Milestone | Status |
|---|---|
| M0 Skeleton | done |
| M1 Claude + agent layer | done |
| M2 Profile | done |
| M3 Scanning | done |
| M4 Documents | done |
| M5 Email | done |
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

## M2 Profile

**Done**
- CV upload (PDF via `unpdf`, DOCX via `mammoth`, LinkedIn PDF export flag) → `profile_extract` task → side-by-side review (extracted text left, every item to confirm / edit / delete right). Nothing is saved before review; a second import merges without duplicating roles.
- Deterministic guard against invented content: every employer / institution and every number in extracted highlights must appear in the CV text (separator-insensitive), otherwise the task retries and then fails.
- Master profile with versions (`profile_versions` + diff), atomic facts derived deterministically from the confirmed profile (stable IDs), manual facts, interview facts. Only confirmed, non-deleted facts are available to writers.
- CV interview: one question at a time, skippable, ends after the gaps are covered (max 15); the summary task may only use the user's answers (numbers are checked against the cited answer) and facts are saved only after the user confirms the summary.
- Writing style: samples per language → `style_analyze` (examples must be quoted verbatim) → style profile; learned rules editable; `{{style_profile}}` text for writing prompts.
- UI: onboarding wizard (language, Claude, CV, interview, style; search and email steps come with M3/M5), profile page (overview, application preferences, facts, interview, style), voice input component (wired up fully in M8).
- Cassettes for all four tasks; engine tests for upload → review → facts, interview, style.

**Known issues**
- Scanned (image-only) PDFs produce little text; the user is told to upload a DOCX or text PDF (no OCR in v1).

## M3 Scanning

**Done**
- `packages/mcp-jobs`: `JobSource` interface and adapters for Greenhouse, Lever (incl. EU), Ashby (with compensation), SmartRecruiters (with bounded detail calls), Workable, Recruitee, Personio (XML), Workday (public CXS JSON, HTML fallback), generic careers pages (model extraction, same-site pagination, bounded detail pages), RSS/Atom feeds and the Arbeitnow board API. Endpoint formats checked against the live public APIs on 2026-11-23; fixtures are synthetic.
- ATS detection from careers URLs, from ATS widgets embedded in company pages, and by probing public APIs with slug guesses when only a name is given.
- Normalisation (titles, companies, locations, canonical URLs, content hash) and dedup (same ATS id or URL, or same company + similar title + similar location) — the second scan never creates duplicate cards (tested).
- Polite fetcher: honest user agent, robots.txt, one request per domain every 5 s, 60 pages per domain per day, ETag/Last-Modified, 6 h cache. Generic page extractions are cached by content hash.
- Matching: deterministic prefilter (exclusions, excluded companies, remote policy, locations, salary floor, posting language, role family) then batched `match_score`; matches above the threshold appear in Found; optional auto-shortlist; one summary notification per scan; failing sources are logged with last success/error time.
- Scheduler: wall-clock daily/weekly/interval jobs with catch-up after sleep (checks every minute and on resume).
- Search profile form + chat thread that proposes changes as diffs; global chat that answers questions from a pipeline snapshot and proposes search-profile, company or settings changes (applied only on confirmation).
- Pipeline board: six columns, drag and drop with mouse, touch and keyboard (arrow keys jump between columns), search, filters, manual "Add job", "Scan now".
- Settings: scan schedule and thresholds, search profile, companies (with discovery suggestions UI), job boards and feeds. `docs/ADDING_A_SOURCE.md`.
- End-to-end tests (Playwright) against a demo engine with synthetic data and recorded model answers (`pnpm --filter @jobhunter/engine demo`): board, search, keyboard move, chat proposal, all screens render, phone layout.

**Known issues**
- Workday tenants vary; the JSON path is tested against a fixture of the public format only.
- The first scheduled scan after a fresh install happens at the next scan time; use "Scan now" right after onboarding.

## M4 Documents

**Done**
- `packages/mcp-docs`: four CV templates (Harvard Business School style, Modern, European, Compact), A4/Letter, photo/no photo, one/two pages, section labels in EN/DE/FR/ES/PT/IT, country conventions for CH, DE, PT, ES, FR, UK, US and MX (US/UK never use a photo; MX on Letter paper, never CURP or marital status). Cover letter template in the same visual family.
- HTML → PDF with Chromium `page.pdf()` (no JavaScript, no network); tests check selectable text, standard headings, one page for Harvard, under 1 MB.
- Tasks `cv_tailor`, `cover_letter`, `form_answers`, `style_rules`. Deterministic truthfulness: every bullet/paragraph/answer cites confirmed fact ids, numbers must appear in the cited facts (separator-insensitive, ignores "B2B"), employers/titles/dates/institutions are overwritten from the profile, missing salary/permit/notice answers become flagged gaps.
- Application language: posting language (stored or detected), the UI language, or a fixed language.
- Package flow: shortlisting (by the user or auto-shortlist) drafts all three documents → Ready to apply + notification; failures return the card to Shortlisted with the reason on the timeline. Versions are kept; regenerate with an instruction; edit; approve.
- Style learning: every edit stores a before/after diff; after 3 edits the `style_rules` task proposes rules the user can accept (Profile → Writing style).
- UI: job detail page (match reasons and gaps, status stepper, package tabs with PDF preview, editors, regenerate with instruction, apply myself / approve / apply with agent, timeline, email tracking, notes), Approvals page, CV templates tab with live preview using the user's profile, CV format settings, photo upload.

**Known issues**
- PDF fonts depend on the fonts installed on the machine (the Docker image installs Liberation/DejaVu).

## M5 Email

**Done**
- `packages/mcp-email`: `EmailProvider` interface; Gmail API adapter (user's own Desktop OAuth client, loopback redirect + PKCE, only `gmail.modify`, incremental sync via `historyId` with fallback, label creation); IMAP adapter (`imapflow`, Gmail app password, UID cursor, `X-GM-LABELS`); MIME parsing, quote stripping.
- Pipeline: multilingual prefilter (ATS senders, applied-company domains and names, job-alert senders, EN/DE/FR/IT/PT/ES keywords) → batched `email_classify` → matching (reference ids, sender domains, company, role; ambiguous matches capped below the threshold) → status change (only above `email_review_confidence` and allowed by the status machine), timeline event, Gmail label; everything else → review queue. Only subject, a 240-character snippet and a body hash are stored.
- LinkedIn job-alert emails parsed deterministically (Jobhunter never visits LinkedIn); other alerts via `alert_parse`; both feed the scan pipeline.
- No-response rule (daily, default 21 days; a later email still updates the status), daily digest for rejections, immediate notifications for interviews and offers, opt-in sent-mail style samples.
- UI: email connection (IMAP app password or Gmail API) in onboarding, Settings and Inbox; Review queue (assign/ignore); Inbox grouped by application; email settings (interval, confidence, no-response days).
- Eval: 55 synthetic emails in six languages (`fixtures/emails`), `pnpm eval:email`: replay of recorded answers gives 100% classification, 45/45 correct links, 33 automatic changes, 0 wrong, 2 sent to review. Tests include a local fake Gmail API server.
- `docs/GMAIL_OAUTH.md`, `docs/GMAIL_IMAP.md`.

**Known issues / not verified**
- The ≥90% accuracy target has **not been measured with a live model** here; the recorded answers were written for the synthetic set. Run `pnpm eval:email --live` locally (and `--record` to keep the results).
- The IMAP adapter has no automated test (no local IMAP server in CI); the Gmail adapter is tested against a fake API.
- Gmail API sign-in in server mode needs an SSH tunnel or the IMAP option (loopback redirect).
