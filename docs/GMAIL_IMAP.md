# Connect Gmail with IMAP and an app password

The simplest way to let Jobhunter read your job-related email. No Google Cloud project needed.

An **app password** is a separate 16-letter password that only works for mail access (IMAP). It is not your Google password, and you can revoke it at any time without changing anything else.

## 1. Turn on 2-Step Verification

App passwords require 2-Step Verification on your Google account.

1. Open <https://myaccount.google.com/security>.
2. Under **How you sign in to Google**, open **2-Step Verification** and turn it on.

## 2. Create an app password

1. Open <https://myaccount.google.com/apppasswords> (or search "App passwords" in your Google account settings).
2. Enter a name such as `Jobhunter` → **Create**.
3. Google shows a 16-letter password (four groups of four). Copy it; Google shows it only once.

If the page says app passwords aren't available, check that 2-Step Verification is on. For Google Workspace accounts, your administrator may have disabled app passwords; use the [Gmail API option](GMAIL_OAUTH.md) instead.

## 3. Make sure IMAP is enabled

Gmail → **Settings (gear) → See all settings → Forwarding and POP/IMAP** → **IMAP access: Enable** → **Save changes**. (New Gmail accounts usually have it on already.)

## 4. Connect in Jobhunter

**Settings → Email → Gmail app password**: enter your Gmail address and the app password → **Connect**. Jobhunter logs in to `imap.gmail.com:993` (TLS) to check the password, stores it in your OS keychain (or the encrypted secrets file in server mode), and starts the first sync of the last 30 days.

Labels such as `Jobhunter/Rejected` and `Jobhunter/Interview` are applied through Gmail's IMAP label extension (`X-GM-LABELS`). Jobhunter never deletes or sends mail.

## Other providers

The IMAP adapter also works with other IMAP servers (host and port can be set through the API). Labels then become IMAP keywords. Only Gmail is supported in v1.

## Revoking access

<https://myaccount.google.com/apppasswords> → delete the `Jobhunter` app password, and click **Disconnect** in Jobhunter.
