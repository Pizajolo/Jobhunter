# Connecting Claude

Jobhunter needs a Claude model for reading CVs, scoring jobs, classifying email and writing documents. You bring your own account; Jobhunter never pays for, resells or routes anyone else's usage. Pick one of the options below in **Settings → Claude account** (or during onboarding).

| Option | Who pays | What Jobhunter stores |
|---|---|---|
| **Claude subscription** (default) | your Claude Pro / Max plan | nothing (the login lives in Claude Code's own credential store) |
| **Anthropic API key** | your Claude Console account, per token | the key, in your OS keychain (or the encrypted secrets file in server mode) |
| **Anthropic-compatible provider** (e.g. Kimi, GLM) | that provider | base URL + your key for that provider |
| **OpenAI via proxy** (LiteLLM etc.) | the proxied provider | base URL + key. *Experimental, unsupported.* |

## Option 1: your Claude subscription (default)

Jobhunter runs Anthropic's **official Claude Code binary** (bundled with the Claude Agent SDK) and asks it whether you are logged in (`claude auth status`). Jobhunter **never collects, stores, proxies or reads** Claude credentials or session tokens; sign-in always happens through Anthropic's own flow.

1. Open a terminal and run the command Jobhunter shows you, usually:

   ```bash
   claude auth login
   ```

   If you don't have Claude Code installed, Jobhunter shows the full path to the bundled binary instead.
   In **server mode** (Docker) the login is stored in the data volume:

   ```bash
   docker compose exec -it jobhunter claude auth login
   ```

2. Finish the login in your browser.
3. Back in Jobhunter, click **Check again**, then **Test connection**.

### Read this before you choose the subscription option

Anthropic's documentation (checked 2026-11-23) says:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
> ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview))

> "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. […] Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
> ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance))

Jobhunter is self-hosted software that you run yourself with your own login; it does not route anyone else's usage. Whether using your subscription this way is allowed is between you and Anthropic. If you are unsure, use an API key, or ask Anthropic (anthropic.com/contact-sales). You can switch at any time without losing data.

Subscription usage counts against your plan's usage limits. The costs Jobhunter shows in this mode are **estimates at API prices**, useful for comparing tasks, not a bill.

## Option 2: Anthropic API key

1. Create a key at [platform.claude.com](https://platform.claude.com/) → API keys.
2. In Jobhunter choose **Anthropic API key**, paste the key and click **Save key**. It goes straight into your OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux) or, in server mode, into the AES-256-GCM encrypted secrets file. It is never written to the database, logs or exports.
3. Click **Test connection**.

In this mode single-shot tasks (classification, scoring, writing) use the Messages API directly; agent tasks (company discovery, form filling) run through the Agent SDK with the same key.

## Option 3: Anthropic-compatible providers

Some providers expose an Anthropic-compatible Messages API. Enter the provider's base URL (from its documentation) and your key for that provider. Check the provider's own documentation for the current URL. Things to know:

- Model names differ: set them under **Settings → Models per task**.
- Structured output support varies. Jobhunter asks for JSON in the prompt and validates every answer, retrying once, but weaker models fail more often (failed tasks are listed under **Diagnostics**).

## Option 4: OpenAI via a proxy (experimental, unsupported)

You can put an Anthropic-compatible proxy such as LiteLLM in front of OpenAI or other models and use it like option 3. This is **not supported**: tool use and structured output frequently break.

## Cost notes

Default models (change them under **Settings → Models per task**):

| Tier | Model | Used for |
|---|---|---|
| Small / fast | `claude-haiku-5-5` | job extraction, match scoring, email classification, job-alert parsing |
| Strong | `claude-sonnet-5-5` | discovery, form filling, CV interview, chat, profile extraction, style |
| Strongest | `claude-opus-5-5` | CV and cover letter writing |

Small tasks are batched (for example up to 20 emails per call) to keep cost and overhead low. **Stats** shows tokens and estimated cost per task type. Set a **monthly budget** in Settings: when it is reached, non-essential tasks (scans, discovery, automatic drafting) pause and you get one notification; email tracking and anything you start yourself keep working.
