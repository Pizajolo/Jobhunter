# Connect Gmail with your own Google Cloud OAuth client

This is the "Gmail API" option in **Settings → Email**. It uses your **own** Google Cloud project, so no shared project or third party ever has access to your mail. If you just want the simplest setup, use an app password instead ([GMAIL_IMAP.md](GMAIL_IMAP.md)).

Jobhunter requests a single scope, `https://www.googleapis.com/auth/gmail.modify`: read messages and add labels. It **cannot send email** and cannot permanently delete anything.

> Google renames console pages from time to time. In 2025 the "OAuth consent screen" moved into **Google Auth Platform** (sections *Branding*, *Audience*, *Clients*, *Data access*). If your console looks different, look for those names.

## 1. Create a project and enable the Gmail API

1. Open <https://console.cloud.google.com/> and sign in with the Google account whose mail you want to track.
2. Project picker → **New project** → name it e.g. `jobhunter-personal` → **Create**.
3. **APIs & Services → Library** → search **Gmail API** → **Enable**.

## 2. Configure the consent screen (Google Auth Platform)

1. **Google Auth Platform → Branding** (formerly "OAuth consent screen") → **Get started**.
2. App name: `Jobhunter (personal)`, user support email: your address.
3. **Audience**: choose **External**. ("Internal" only exists for Google Workspace organisations.)
4. Contact email: your address → **Create**.
5. **Audience → Test users → Add users**: add your own Gmail address.
6. **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/gmail.modify` → **Update** → **Save**.

## 3. Switch publishing status to "In production"

While an External app is in **Testing**, Google expires its refresh tokens after **7 days**, and Jobhunter would lose access every week.

1. **Audience → Publishing status → Publish app** → confirm.
2. Google will say the app needs verification because `gmail.modify` is a *restricted* scope. **You don't need verification for personal use**: unverified apps work for up to 100 users, and you are the only one. You will see a warning during sign-in (step 5).

## 4. Create a Desktop OAuth client

1. **Google Auth Platform → Clients → Create client**.
2. Application type: **Desktop app**, name: `Jobhunter`.
3. **Create**, then copy the **Client ID** and **Client secret** (or download the JSON).

A "Desktop app" client allows sign-in through a loopback address (`http://127.0.0.1:<port>`), which is how Jobhunter receives the authorization code. PKCE is used as well.

## 5. Connect in Jobhunter

1. **Settings → Email → Gmail API**: paste the client ID and secret → **Sign in with Google**.
2. A browser tab opens on Google. Choose your account.
3. Google shows **"Google hasn't verified this app"**. Since this is your own app: **Advanced → Go to Jobhunter (personal) (unsafe)**.
4. Allow access. The tab shows "Connected"; return to Jobhunter.

The client secret and the refresh token are stored in your OS keychain (or the encrypted secrets file in server mode). They are never written to the database, logs or exports.

### Server mode (Docker)

The loopback redirect goes to `127.0.0.1` on **the machine running the browser**. For a remote server, either:

- open Jobhunter through an SSH tunnel (`ssh -L 4317:127.0.0.1:4317 your-server`) and connect from `http://127.0.0.1:4317`, or
- use the IMAP option, which needs no redirect.

## Revoking access

<https://myaccount.google.com/permissions> → Jobhunter (personal) → **Remove access**. Also click **Disconnect** in Jobhunter to delete the stored token.

## What Jobhunter does with your mail

See [PRIVACY.md](PRIVACY.md). In short: only job-related messages (selected by a local filter) are classified by your Claude model; Jobhunter stores the subject, a 240-character snippet and a hash of the body, never full bodies; labels such as `Jobhunter/Rejected` are added if you leave that option on.
