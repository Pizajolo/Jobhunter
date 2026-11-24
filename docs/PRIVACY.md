# Privacy

Jobhunter is local-first. There is no Jobhunter server, no account and no telemetry. Everything it knows lives on your computer (desktop app) or on your server (Docker), and you can export or delete all of it at any time.

## What is stored where

| What | Where |
|---|---|
| Profile, confirmed facts, search profile, companies, jobs, matches, applications and their timeline, document texts, chat, model usage, settings | SQLite database `jobhunter.sqlite` in the data folder |
| Generated CVs and cover letters (PDF), uploaded CV, photo, screenshots of submitted applications | `files/` in the data folder |
| Logins to job portals (cookies) | `browser-profile/` in the data folder, used only by the application browser |
| Email: sender, subject, a 240-character snippet, a hash of the body, the classification and the link to an application | database. **Full email bodies are not stored.** |
| Writing-style samples you paste, or (if you opt in) short excerpts of your own sent emails | database |
| API key, Gmail client secret and refresh token, IMAP app password | OS keychain on desktop; AES-256-GCM encrypted file in server mode (key from `JOBHUNTER_MASTER_KEY`). Never in the database, logs or exports. |
| Claude subscription login | Claude Code's own credential store. Jobhunter never reads it. |
| Logs | `logs/engine.log`. Keys, tokens, passwords, cookies and email bodies are redacted before writing. |
| Local Whisper speech model | your browser's cache (downloaded once) |

Data folder: macOS `~/Library/Application Support/Jobhunter/data`, Windows `%APPDATA%\Jobhunter\data`, Linux `~/.local/share/jobhunter`, Docker the `/data` volume. **Settings → Your data** shows the exact path and size.

## What leaves your machine

1. **Model calls**, to the provider you chose (Anthropic by default; see [CLAUDE_ACCOUNT.md](CLAUDE_ACCOUNT.md)). Each task sends only what it needs:

   | Task | Sends |
   |---|---|
   | CV extraction, CV interview | your CV text, your answers |
   | Match scoring | a profile summary, up to 120 confirmed facts, your search profile, the job postings |
   | CV, cover letter, form answers | confirmed facts, writing-style rules, the posting |
   | Email classification | sender, subject, date and up to 3,500 characters of the email text (quoted replies removed), plus the company and title of your open applications. Only emails that pass a local filter (job-related senders and keywords) are sent; the rest never leave your machine. |
   | Job-alert parsing | the alert email's text |
   | Company discovery | a profile summary and your search profile; the agent then runs web searches through the provider's search tool |
   | Form filling | the form's field labels and your approved answers |
   | Chat | your message and the data it needs to answer |

   Every call is listed under **Diagnostics** and **Stats**. With an Anthropic account, Anthropic's [commercial terms](https://www.anthropic.com/legal/commercial-terms) or [consumer terms](https://www.anthropic.com/legal/consumer-terms) and its privacy policy apply to these calls, depending on how you sign in.

2. **Job sites**: Jobhunter fetches job boards and company career pages (ATS APIs first), with an honest user agent, respecting robots.txt and rate limits. It never visits LinkedIn.
3. **Your email provider**: Gmail API or IMAP, once you connect it. Jobhunter only reads and labels messages; it never sends email.
4. **Applying**: the application browser opens the employer's form and, only in the modes you allow, submits it.
5. **Downloads on first use**: Chromium for PDFs and applying (desktop, from Playwright's CDN) and the Whisper speech model (from Hugging Face) if you use local voice input. Your recordings themselves never leave the device: speech is transcribed in your browser.

Browser speech recognition (the alternative voice option) may send audio to your browser's vendor; Settings says so where you choose it.

## Export and delete

- **Export**: Settings → Your data → *Export all data*. You get a zip with the database, all files, and your profile and settings as JSON. Secrets and portal logins are left out on purpose.
- **Delete everything**: Settings → Your data → *Delete everything*, then type `DELETE`. This removes all database rows, files, the application browser profile, logs and all saved secrets. Only the server-mode sign-in password is kept, so you can still get in. Your Claude login belongs to Claude Code; sign out with `claude auth logout`.
- To remove Jobhunter completely, also delete the data folder above (and in Docker the `jobhunter-data` volume).

Email labels Jobhunter added in Gmail (`Jobhunter/…`) stay in your mailbox; delete them in Gmail if you like. To revoke Gmail access, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
