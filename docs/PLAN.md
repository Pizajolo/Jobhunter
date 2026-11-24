# Implementation plan

Status: **approved with the decisions in §8** (2026-11-23). Product name: **Jobhunter**.

---

## 1. Findings from the current docs (checked 2026-11-23)

These change parts of the spec. Each item has a proposed alternative.

### 1.1 Claude subscription login conflicts with Anthropic's current terms (blocking: Q1)

Spec §2.1 makes the user's own Claude subscription, through the Claude Code login that the Agent SDK uses, the **default**. Anthropic's current docs say:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
> (code.claude.com/docs/en/agent-sdk/overview)

> "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."
> (code.claude.com/docs/en/legal-and-compliance, "Authentication and credential use")

Your design is careful: the app never touches credentials and only detects an existing login. Even so, an open-source product whose default runtime runs on Pro/Max credentials falls under the "offer claude.ai login … for their products, including agents built on the Claude Agent SDK" clause. Anthropic also says it "may enforce these restrictions without prior notice", and the risk falls on every user's account.

**Proposed alternative (recommended):**
- **Default:** the user's own **Anthropic API key** (Claude Console), stored in the OS keychain. That is the method the docs name for Agent SDK products. It is billed to the user, which also meets "each end user authenticates with their own credentials".
- **Also:** Anthropic-compatible endpoints (base URL + the user's key for that provider), plus OpenAI-via-proxy marked "experimental, unsupported", as in the spec.
- **Not shipped:** any path that runs on claude.ai subscription credentials. The `AgentRunner` interface keeps that door open if Anthropic approves it. `docs/CLAUDE_ACCOUNT.md` will explain why and link the two pages above.
- Onboarding step 2 then becomes "Connect Claude: paste your API key (stored in your OS keychain)" with a "Test connection" button.

If you want subscription login anyway (for example only for your own personal use, or after asking Anthropic for approval at anthropic.com/contact-sales), tell me and I'll build it as an opt-in that is off by default. I won't make it the default without that decision.

### 1.2 Agent SDK facts that shape the design
- Package `@anthropic-ai/claude-agent-sdk`. `query({prompt, options})` runs a **bundled Claude Code binary as a subprocess** per query. Relevant options: `model`, `tools` (an array of built-in tool names; `[]` turns all of them off), `allowedTools`, `disallowedTools`, `mcpServers`, `outputFormat: {type:'json_schema', schema}`, `maxTurns`, `maxBudgetUsd`, `settingSources` (`[]` stops it from loading the user's `~/.claude` config), `env`, `cwd`.
- In-process MCP servers: `createSdkMcpServer({name, tools})` + `tool(name, description, zodShape, handler)`.
- Consequence: starting a subprocess for every small call (classifying one email, scoring one job) is slow and heavy. See §3.3 for the two-backend runner (Q2).

### 1.3 Gmail
- Google now runs an **official remote Gmail MCP server** (`https://gmailmcp.googleapis.com/mcp/v1`, OAuth 2.0, documented scopes `gmail.readonly` and `gmail.compose`, tools such as `create_draft`). It needs the same per-user Google Cloud project, it is built around compose/draft scopes that v1 must not use (§2.2: never send), and it is a remote dependency. **Proposal:** v1 uses the Gmail REST API directly (`@googleapis/gmail` + `google-auth-library`, Desktop OAuth client with loopback redirect + PKCE). The `EmailProvider` interface keeps room for a Gmail-MCP adapter later.
- Scopes: `gmail.readonly` is not enough to apply labels to messages, so v1 requests **`gmail.modify`** (read + change labels, no send permission; deleting forever needs the full `mail.google.com` scope, which we never request). It is a Google "restricted" scope. For a personal, unverified, *In production* app that means a one-time "unverified app" warning and a cap of 100 test users, which is fine for one user per project. `GMAIL_OAUTH.md` covers this.
- IMAP: `imapflow` (maintained) + `mailparser`. Gmail labels via the `X-GM-LABELS` extension; IDLE, falling back to polling.

### 1.4 Other libraries I'll re-verify at the start of their milestone
Electron (current major, `utilityProcess`, notarization) at M7; Playwright `launchPersistentContext` + `page.pdf()` at M4/M6; Kimi / GLM Anthropic-compatible base URLs and whether they support structured outputs at M1; local Whisper (transformers.js vs whisper.cpp bindings) at M8. `keytar` is archived, so the plan uses `@napi-rs/keyring`.

---

## 2. Architecture decisions

| Area | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS, pnpm workspaces, TypeScript strict, ESM | Spec; matches the Agent SDK |
| Engine HTTP | Fastify 5 + `@fastify/websocket`, `@fastify/static`, `@fastify/cookie` | Boring, fast, typed, schema-friendly |
| Validation | Zod 4 everywhere (`packages/shared`); JSON Schema derived for model outputs | One source for API, DB JSON columns and LLM schemas |
| DB | SQLite via `better-sqlite3` + **Drizzle ORM**, migrations with `drizzle-kit` (SQL files committed) | Synchronous, fast, a single file; Drizzle gives typed queries. Electron uses `@electron/rebuild` |
| Scheduler | `croner` with a "missed runs" table for catch-up after sleep | Small, handles time zones |
| Logging | `pino` with a redaction list (keys, tokens, passwords, `authorization`, email bodies) | Spec §7 |
| Secrets | Desktop: `@napi-rs/keyring` (OS keychain). Server: AES-256-GCM file, key from `scrypt(JOBHUNTER_MASTER_KEY)` held in an env var or Docker secret | Spec §2.7 |
| Server login | `@node-rs/argon2` password hash, HttpOnly SameSite=Strict session cookie, CSRF token, login rate limit, bind to `127.0.0.1` by default | Spec §2.7 |
| Web UI | React 19, Vite, Tailwind v4, React Router, TanStack Query, `@dnd-kit` (keyboard-accessible drag and drop), `i18next` | dnd-kit has keyboard sensors (WCAG); TanStack Query + WebSocket invalidation keeps the UI a pure DB view (§3.2) |
| UI style | Tokens from your mockup: ground `#F6F6F3`, surface `#FFFFFF`, border `#E4E4DF`, text `#17181C` / `#3F424A` / `#5D6068`, accent `#2B50D6` (link `#1F3FB0`), warn tag `#FDEBD8` / `#8A4B0C`, Inter. Plus a dark theme | Matches the mockup |
| HTTP scraping | `undici` fetch, `robots-parser`, a per-domain token-bucket queue (5 s, 60 pages per day), ETag/Last-Modified + content-hash cache in SQLite, `cheerio` to strip HTML before model extraction | Spec §2.6 |
| CV text | `unpdf` (PDF.js-based, maintained) + `mammoth` (DOCX) | `pdf-parse` has had long maintenance gaps |
| PDF output | HTML templates → Playwright Chromium `page.pdf()` | Spec; text-selectable |
| Browser | `playwright` library, `launchPersistentContext` (one profile dir per user) | Spec §5.6 |
| Desktop | Electron + `electron-builder`; the engine runs in `utilityProcess`; tray, autostart, notifications | Spec §3.5 |
| Tests | Vitest (unit), `@playwright/test` (UI + mock forms), recorded HTTP fixtures via undici `MockAgent` | No live calls in CI |

### 2.1 Repo layout

```
apps/
  engine/
    src/
      server/        Fastify app, routes, ws hub, auth (server mode)
      agent/         AgentRunner, runners, model routing, usage/budget
      tasks/         one file per task: input/output Zod + orchestration
      scheduler/     croner jobs, catch-up
      pipelines/     scan, match, email, apply (deterministic glue)
      secrets/       keychain + encrypted-file backends
    prompts/         <task>.md (versioned, front-matter: version, model tier)
    test/
  web/
    src/{routes,components,features,i18n/{en,de,pt,es,fr}.json}
  desktop/
    src/{main.ts,tray.ts,engine-process.ts,notifications.ts}
packages/
  shared/            Zod schemas, enums (status, classification), status machine, settings defaults
  db/                drizzle schema, migrations/, repositories (the only code that writes SQL)
  mcp-jobs/          JobSource interface, adapters/*, dedup, normalize, MCP tool defs
  mcp-email/         EmailProvider (gmail, imap), prefilter, matcher, MCP tool defs
  mcp-pipeline/      application/status/event/note tools
  mcp-docs/          profile + facts tools, templates/, renderer (HTML→PDF)
  mcp-browser/       Playwright session manager, form reader, fillers/*, safety detectors
fixtures/
  http/<adapter>/*.json     recorded responses
  emails/*.eml + labels.json   eval set (50+, synthetic)
  forms/                    local mock application forms (greenhouse-like, workday-like, captcha)
  llm/<task>/*.json         recorded model outputs (cassettes)
docker/  Dockerfile, docker-compose.yml
docs/    PLAN.md, PROGRESS.md, + guides from spec §9
.github/workflows/  ci.yml, release.yml
```

Each `mcp-*` package exports (a) its tool definitions as plain typed functions over `packages/db`, (b) an in-process `createSdkMcpServer` wrapper for the Agent SDK, and (c) a small stdio entry point, so the same tools also work from any external MCP client (for example Claude Desktop). Agents and the UI never write SQL directly (spec §3.2).

---

## 3. Agent layer

### 3.1 `AgentRunner`
```ts
interface AgentRunner {
  run<I, O>(task: TaskDef<I, O>, input: I, opts: { tools: ToolSet; model: ModelRef; signal?: AbortSignal }): Promise<TaskResult<O>>;
}
type TaskResult<O> = { ok: true; output: O; usage: Usage } | { ok: false; error: TaskError; usage: Usage };
```
`TaskDef` = name, prompt file, input/output Zod schemas, model tier, `essential` flag (for budget pausing), and an optional deterministic post-check (for example: "every fact ID cited exists in profile_facts").

Validation: parse the output with Zod. On failure, retry once with the validation error appended. On a second failure, store a `task_runs` row with status `failed` and show the error in the UI (Diagnostics + the job card).

### 3.2 Model routing
Settings hold provider profiles (`anthropic` API key, or `compatible` base URL + key) and a `task → {provider, model}` map. Defaults, using the spec's tiers:

| Tier | Default model | Tasks |
|---|---|---|
| small/fast | `claude-haiku-5-5` | job extraction, match scoring, email classification, job-alert parsing |
| strong | `claude-sonnet-5-5` | discovery, form filling, CV interview, chat, profile extraction, style analysis |
| strongest | `claude-opus-5-5` | CV + cover letter writing |

The pricing table ships as data (editable), and every call records input/output/cache tokens and an estimated cost in `usage_log`. Monthly budget: before each task, `spent_this_month + estimate > budget` pauses **non-essential** tasks (discovery, auto-shortlist drafting, re-scoring), always lets essential tasks run (email status updates, user-triggered actions), and notifies once.

### 3.3 Two runner backends (Q2)
- **`MessagesRunner`** (`@anthropic-ai/sdk`, Messages API with structured outputs `output_config.format`): for single-shot tasks (extraction, scoring, classification, letter/CV writing, interview turns, chat turns that propose diffs). One HTTP call, exact usage numbers, no subprocess. For compatible endpoints without structured outputs, it falls back to JSON in the text + Zod validation.
- **`AgentSdkRunner`** (`@anthropic-ai/claude-agent-sdk`): for the open-ended loops the spec names (company discovery with web search, browser form filling). It runs with `tools: []` (no built-in Bash/Write/Edit), `settingSources: []`, only our in-process MCP servers attached, `allowedTools` set per task, `outputFormat` for the final result, `maxTurns`, and `maxBudgetUsd` tied to the remaining budget.

Both sit behind the same interface, so the rest of the app doesn't care which one ran. The spec says "Agent SDK as the default runtime". I propose the Agent SDK for agent loops and the Messages API for small calls, which matches §3.3 "deterministic code + small model calls". Q2 asks you to confirm.

### 3.4 Prompts + harness
`apps/engine/prompts/<task>.md` with front-matter (`version`, `tier`, `output_schema` ref), sections for role/goal, input, output schema (rendered from Zod at build time so it can't drift), the truthfulness rules (one shared include for every writing task), and 2–3 synthetic examples. Placeholders `{{language}}` and `{{style_profile}}`.
`pnpm test:prompts`: for each task, loads `fixtures/llm/<task>/*.json` cases (input + assertions). **Replay mode** (default, CI) checks the recorded outputs against the schema and assertions. **Live mode** (`--live`, needs a key) calls the model, checks the result and can re-record. The same harness runs `pnpm eval:email`.

---

## 4. Data model notes (beyond spec §4)
- Extra tables: `task_runs` (status, error, model, tokens, cost, duration), `usage_log`, `http_cache`, `source_health` (last success/error per source), `scan_runs`, `style_edits` (diffs awaiting rule extraction), `approvals` (view over documents/form fills), `auth_sessions` (server mode), `migrations` (drizzle).
- `profile`: JSON Resume + extensions in a JSON column, with a `profile_versions` table (one row per change, with a diff).
- `documents.facts_used`: an array of `profile_facts.id`. The writer must cite fact IDs per bullet or paragraph, and a deterministic check rejects any ID that doesn't exist (§2.4). Numbers and dates in generated text are cross-checked against the cited facts; a mismatch is flagged.
- `applications.status`: an explicit state machine in `packages/shared` (allowed transitions, and who may make each one: user | agent | email), unit-tested. Email-driven changes are only automatic at or above `email_review_confidence`.
- Indexes: `jobs(content_hash)`, `jobs(company_id, norm_title)`, `jobs(ats_type, ats_job_id)` unique, `emails(provider_message_id)` unique, `applications(status)`, `events(application_id, created_at)`.

---

## 5. Milestones

Every milestone ends with: lint + typecheck + tests green, `docs/PROGRESS.md` updated, a commit, and a summary to you.

### M0 Skeleton
pnpm workspace, tsconfig base (strict, `noUncheckedIndexedAccess`), ESLint (typescript-eslint strict) + Prettier; engine `/api/health`; Fastify serving the built web app; web shell (sidebar from the mockup, routes for all 9 screens as placeholders, i18n with EN/DE/PT/ES/FR stubs, a check that fails CI on missing keys); `packages/db` with an initial migration of all spec tables; settings store with the §8 defaults (typed, Zod-validated); secrets wrapper (keychain + encrypted file + in-memory for tests); pino with redaction; GitHub Actions CI (lint, typecheck, test, build).
*Tests:* settings defaults, secrets round-trip (file backend), migration up on an empty DB, health endpoint, redaction.

### M1 Claude + agent layer
Provider settings + "Test connection"; API-key storage; (subscription detection only if Q1 says so); `AgentRunner` with both backends; model routing UI in Settings; prompt loader + `pnpm test:prompts`; usage logging + cost estimate; budget gate; task-run records shown on a basic Diagnostics page.
*Tests:* routing resolution, the budget gate, Zod retry-once-then-fail (with a fake runner), prompt rendering, the cassette harness.

### M2 Profile
Onboarding wizard steps 1–5 (language, Claude, CV upload, interview, style). CV upload (PDF/DOCX + LinkedIn PDF) → text → `profile_extract` task → side-by-side review (confirm / edit / delete per item) → `profile` version + `profile_facts`. Text interview: one question at a time, skippable, a summary that must be confirmed before facts are saved. Style profile from 3–10 pasted/uploaded samples per language (inbox sampling waits until M5). Profile screen.
*Tests:* extraction glue with cassettes, the facts lifecycle, interview state machine, style aggregation.

### M3 Scanning
Search profile form + chat → structured diff → confirm. Companies (add by name/URL, ATS auto-detection from the careers URL and page markers). Adapters: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio (public JSON/XML feeds), Workday (public CXS JSON + HTML fallback), a generic careers page (model extraction, pagination, content-hash cache), and one RSS/API board as the reference plugin. Etiquette layer (robots, rate limit, daily cap, honest UA `Jobhunter/<ver> (+repo URL)`, cache). Normalize → dedup → store → match: a deterministic pre-filter (exclusions, location/remote, salary floor, language), then a small-model score with reasons and gaps, cached by `(job hash, profile version, search profile version)`. Scheduler + catch-up; one summary notification per scan; source health. **Pipeline board** (6 columns, dnd-kit drag and drop that calls the status machine, search, filters).
*Tests:* every adapter against recorded fixtures; dedup cases (same ATS ID, URL variants, title/location similarity, re-posts); matching pre-filter; a scan with one failing source; "no duplicate cards" property test; board e2e.

### M4 Documents
2–3 CV templates (A4/Letter, photo / no photo, 1–2 pages, country conventions such as DE photo + date of birth as optional fields, US no photo), a cover letter template, the HTML→PDF renderer (checks: under 1 MB, real text, standard headings). Tasks: `cv_tailor` (select + order + rewrite with fact citations), `cover_letter`, `form_answers` (common answers from settings + custom questions). Job detail view (header, stepper, why-it-matches, package tabs, PDF preview, edit/regenerate-with-instruction/approve, timeline, notes). Approvals queue. Style learning: store edit diffs, every N=3 edits run `style_rules` and propose rules as a diff.
*Tests:* the truthfulness checker (invented employer / number / date → rejected), PDF size and text extraction, template snapshots, approve flow e2e.

### M5 Email
`EmailProvider` + Gmail API adapter (OAuth loopback + PKCE, `historyId` incremental sync, labels) + IMAP adapter (app password, `X-GM-LABELS`, IDLE/poll). Pipeline: prefilter (ATS sender domains, applied-company domains, alert senders, multilingual keywords) → `email_classify` (small model, JSON: class, company, role, confidence, key sentence) → matcher (sender domains, ATS reference IDs, company + role similarity) → act (status, event, `Jobhunter/*` label) or the review queue below 0.8. Job alerts (LinkedIn and others) → `alert_parse` → scan pipeline. No-response rule (daily job, 21 days). Review queue + Inbox screens. Style sampling from sent mail (opt-in). Only body hashes are stored, plus a snippet.
*Eval:* `fixtures/emails/` with 50+ synthetic `.eml` files in EN/DE/FR/IT/PT/ES covering all 8 classes plus tricky cases (a rejection that mentions "interview", a recruiter cold email, a newsletter from an ATS). `pnpm eval:email` reports accuracy and **wrong automatic changes above the threshold (target 0)**.
*Tests:* the prefilter, matcher, status side effects, idempotent re-sync, IMAP against a local fake server, Gmail against a mocked HTTP API.

### M6 Applying
Browser session manager (persistent profile; headed on desktop, headless on server). Form reader (labels, required fields, file inputs, multi-step detection). **Deterministic fillers for Greenhouse, Lever and Ashby** (the DoD targets), plus the `form_fill` agent (Agent SDK + `mcp-browser` tools) for other forms. Answers come only from the approved package/profile; unknown fields are left empty and flagged. Safety stops: CAPTCHA (reCAPTCHA / hCaptcha / Turnstile / challenge pages), login walls, password / 2FA fields, payment fields, unexpected navigation or errors. Each one hands over to you. The submit gate is one pure function, `canAutoSubmit(policy, ctx)`, enforcing every condition in §5.6 with a fall-back to level 2. After submit: screenshot + audit event + `applied` + sender domains / reference IDs. Mock forms in `fixtures/forms/` (Greenhouse-like, Lever-like, Ashby-like, Workday-like multi-step, CAPTCHA placeholder, login wall, unknown required field).
*Tests:* e2e for each mock form at each level; CAPTCHA/login/unknown → must stop; daily cap; exclusion list (linkedin.com always excluded, not removable).

### M7 Packaging
Electron app (engine in `utilityProcess`, tray, autostart, notifications, catch-up scans after `powerMonitor` resume, data folder in the OS app-data location, "Open data folder"). Docker: multi-stage image based on the Playwright image, non-root user, a volume for `/data`, a healthcheck, compose file binding to `127.0.0.1`. Server login (first-run password setup). Responsive pass (board → horizontal scroll / column switcher on phones). Release workflow: electron-builder for mac/win/linux + GHCR image. Server-mode notifications: email digest is out (no sending in v1), so **web push** (VAPID, self-generated keys) + an in-app notification centre.
*Tests:* server auth (login, wrong password, rate limit, cookie flags), Docker build in CI, Electron smoke test on Linux under xvfb.

### M8 Extras + polish
Voice for the interview (local Whisper by default with a model download on first use; browser Web Speech as an opt-in; speech synthesis for questions), discovery agent (weekly, accept/reject, auto-add toggle), Stats screen (rates by source and role type, time to first reply, model cost per task), budget UI, Diagnostics (source health, last scan, failed tasks, log download with redaction), data export (zip of DB + files) and delete-everything, all §9 docs, README with screenshots, first release tag.

---

## 6. What I can and can't test in this environment
- **Can:** all unit/integration tests, recorded-fixture adapter tests, Playwright e2e of the UI and the mock application forms, PDF rendering, Docker build (if Docker is available here; otherwise only in CI), Electron on Linux headless.
- **Can't, without help:** live model calls (no Anthropic API key here; see Q4), real Gmail/IMAP (synthetic fixtures + local fake servers instead), macOS/Windows desktop builds and signing (CI only; signing needs your certificates), real company career sites (recorded fixtures; one optional live smoke script you run yourself).
- The §5.5 **≥90% accuracy target needs live runs.** Without a key I'll build the eval and replay recorded outputs, and report the live number as "not measured".

## 7. Honest limitations to document
- In server mode, "prepare" can't hand a half-filled form to your phone: form state lives in the headless browser session. v1 gives you a screenshot of the prefilled form + the posting link + copyable answers. (A later option: stream the headless browser via noVNC.)
- On desktop, the Playwright browser opens as its **own Chromium window** next to the app, not embedded inside the Electron window. Embedding means driving Electron's own webview over CDP, which is less reliable (Q5).
- Some ATS portals (Workday especially) vary a lot per tenant; the generic agent will hand over more often there.

---

## 8. Decisions (2026-11-23)

1. **Claude auth:** the owner chose the **Claude subscription (official Claude Code login via the Agent SDK) as the default**, after reading §1.1. The app never reads, stores or proxies credentials: it only asks the bundled Claude Code binary whether a login exists and otherwise shows `claude auth login` (or `/login`). API key and Anthropic-compatible endpoints remain alternatives. `docs/CLAUDE_ACCOUNT.md` quotes Anthropic's terms so every user can make an informed choice.
2. **Runners:** in subscription mode every task runs through the **Agent SDK** (built-in tools off, our MCP tools only), with small tasks **batched** (for example 20 emails or 10 jobs per query) to limit subprocess overhead. In API-key / compatible mode, single-shot tasks use the Messages API and agent loops use the Agent SDK.
3. **License:** MIT (already in the repo).
4. **Live tests:** the owner runs live prompt tests and the email eval locally; CI and this build use recorded outputs.
5. **Desktop browser:** try to show the apply browser inside the app (Electron `WebContentsView` driven over CDP); fall back to a separate Chromium window.
6. **Name:** Jobhunter. Gmail labels `Jobhunter/Rejected`, `Jobhunter/Interview`, …
7. **Repo:** github.com/Pizajolo/Jobhunter.
8. **CV conventions:** CH, DE, PT, ES, FR, UK, US, **MX**. Several templates, including a **Harvard Business School** style one-page résumé.

### Changes during the build (2026-11-24)

- **Voice lives in the web app**, not in a `packages/voice` package: local Whisper runs in the browser (transformers.js + WebAssembly, in a web worker), so audio never leaves the device and no native ML runtime (about 300 MB) ships with the desktop app. The ONNX runtime files are bundled; only the model downloads on first use. Browser Web Speech remains the opt-in alternative; read-aloud uses the system's speech synthesis.
- **One data folder** for the desktop app, the engine and the MCP server (`~/Library/Application Support/Jobhunter/data`, `%APPDATA%\Jobhunter\data`, `~/.local/share/jobhunter`).
- **MCP stdio**: only `mcp-pipeline` has an external stdio server (`main.js mcp`, read-only unless `--allow-writes`), since that is what is useful from other clients. The other `mcp-*` packages expose typed functions used in-process.
- **Discovery** guards the web tools with a `PreToolUse` hook that refuses LinkedIn fetches and searches, on top of the prompt rule and the post-filter.

