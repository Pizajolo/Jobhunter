import { gmail, type gmail_v1 } from '@googleapis/gmail';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { EmailProvider, RawEmail, SyncResult } from './types.js';
import { parseRawMessage } from './parse.js';

/**
 * Narrowest scope that allows reading mail and applying labels. It cannot send email and cannot
 * delete messages permanently (spec §2.2).
 */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Start the OAuth flow with the user's own Google Cloud "Desktop app" client (loopback redirect + PKCE). */
export async function gmailAuthUrl(cfg: GmailClientConfig, state: string): Promise<{ url: string; codeVerifier: string }> {
  const client = new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  });
  return { url, codeVerifier: codeVerifier! };
}

export async function gmailExchangeCode(cfg: GmailClientConfig, code: string, codeVerifier: string): Promise<{ refreshToken: string }> {
  const client = new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri });
  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Jobhunter from your Google account permissions and try again.');
  return { refreshToken: tokens.refresh_token };
}

export class GmailApiProvider implements EmailProvider {
  readonly kind = 'gmail_api' as const;
  private readonly api: gmail_v1.Gmail;
  private labelIds = new Map<string, string>();

  constructor(cfg: Omit<GmailClientConfig, 'redirectUri'>, refreshToken: string, opts: { rootUrl?: string; accessToken?: string } = {}) {
    const auth = new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret });
    auth.setCredentials({ refresh_token: refreshToken, ...(opts.accessToken ? { access_token: opts.accessToken, expiry_date: Date.now() + 3600_000 } : {}) });
    this.api = gmail({ version: 'v1', auth, ...(opts.rootUrl ? { rootUrl: opts.rootUrl } : {}) });
  }

  async verify(): Promise<string> {
    const p = await this.api.users.getProfile({ userId: 'me' });
    return p.data.emailAddress ?? '';
  }

  private async fetchMessage(id: string): Promise<RawEmail> {
    const m = await this.api.users.messages.get({ userId: 'me', id, format: 'raw' });
    const raw = Buffer.from(m.data.raw ?? '', 'base64url');
    return parseRawMessage(raw, { id, threadId: m.data.threadId ?? null, labels: m.data.labelIds ?? [], date: m.data.internalDate ? new Date(Number(m.data.internalDate)) : undefined });
  }

  /** Incremental sync via historyId (spec §5.5); first run lists the last N days. */
  async sync(cursor: string | null, opts: { initialDays: number; max: number }): Promise<SyncResult> {
    const ids: string[] = [];
    let historyId: string | null = null;
    if (cursor) {
      try {
        let pageToken: string | undefined;
        do {
          const h = await this.api.users.history.list({ userId: 'me', startHistoryId: cursor, historyTypes: ['messageAdded'], labelId: 'INBOX', pageToken, maxResults: 500 });
          for (const rec of h.data.history ?? []) for (const added of rec.messagesAdded ?? []) if (added.message?.id) ids.push(added.message.id);
          historyId = h.data.historyId ?? historyId;
          pageToken = h.data.nextPageToken ?? undefined;
        } while (pageToken && ids.length < opts.max);
      } catch (err) {
        // 404: history too old → fall back to a time-based listing
        if ((err as { code?: number }).code !== 404) throw err;
        cursor = null;
      }
    }
    if (!cursor) {
      const profile = await this.api.users.getProfile({ userId: 'me' });
      historyId = profile.data.historyId ?? null;
      let pageToken: string | undefined;
      do {
        const list = await this.api.users.messages.list({ userId: 'me', q: `newer_than:${opts.initialDays}d -in:chats -in:sent`, maxResults: 100, pageToken });
        for (const m of list.data.messages ?? []) if (m.id) ids.push(m.id);
        pageToken = list.data.nextPageToken ?? undefined;
      } while (pageToken && ids.length < opts.max);
    }
    const messages: RawEmail[] = [];
    for (const id of [...new Set(ids)].slice(0, opts.max)) messages.push(await this.fetchMessage(id));
    return { messages, cursor: historyId ?? cursor ?? '' };
  }

  private async labelId(name: string): Promise<string> {
    if (!this.labelIds.size) {
      const list = await this.api.users.labels.list({ userId: 'me' });
      for (const l of list.data.labels ?? []) if (l.name && l.id) this.labelIds.set(l.name, l.id);
    }
    const existing = this.labelIds.get(name);
    if (existing) return existing;
    const created = await this.api.users.labels.create({ userId: 'me', requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
    this.labelIds.set(name, created.data.id!);
    return created.data.id!;
  }

  async addLabel(id: string, label: string): Promise<void> {
    const labelId = await this.labelId(label);
    await this.api.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: [labelId] } });
  }

  async listSent(max: number): Promise<RawEmail[]> {
    const list = await this.api.users.messages.list({ userId: 'me', q: 'in:sent newer_than:365d', maxResults: max });
    const out: RawEmail[] = [];
    for (const m of list.data.messages ?? []) if (m.id) out.push(await this.fetchMessage(m.id));
    return out;
  }

  async close(): Promise<void> {
    /* stateless HTTP client */
  }
}
