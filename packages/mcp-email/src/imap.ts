import { ImapFlow } from 'imapflow';
import type { EmailProvider, RawEmail, SyncResult } from './types.js';
import { parseRawMessage } from './parse.js';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Gmail app password (never the account password). */
  password: string;
}

/** IMAP adapter (Gmail with an app password). Gmail labels via X-GM-LABELS. */
export class ImapProvider implements EmailProvider {
  readonly kind = 'imap' as const;
  private client: ImapFlow | null = null;

  constructor(private readonly cfg: ImapConfig) {}

  private async conn(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    const c = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.cfg.password },
      logger: false,
      disableAutoIdle: true,
    });
    await c.connect();
    this.client = c;
    return c;
  }

  private get isGmail(): boolean {
    return /gmail\.com$|googlemail\.com$/iu.test(this.cfg.host);
  }

  async verify(): Promise<string> {
    await this.conn();
    return this.cfg.user;
  }

  /** Cursor = "<uidValidity>:<lastUid>". */
  async sync(cursor: string | null, opts: { initialDays: number; max: number }): Promise<SyncResult> {
    const c = await this.conn();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const box = c.mailbox;
      const validity = box && typeof box === 'object' ? String(box.uidValidity) : '0';
      const [prevValidity, prevUid] = (cursor ?? '').split(':');
      let uids: number[];
      if (cursor && prevValidity === validity) {
        const found = await c.search({ uid: `${Number(prevUid) + 1}:*` }, { uid: true });
        uids = (found || []).filter((u) => u > Number(prevUid));
      } else {
        const since = new Date(Date.now() - opts.initialDays * 86_400_000);
        uids = (await c.search({ since }, { uid: true })) || [];
      }
      uids = uids.sort((a, b) => a - b).slice(-opts.max);
      const messages: RawEmail[] = [];
      if (uids.length) {
        for await (const m of c.fetch(uids, { uid: true, source: true, internalDate: true, ...(this.isGmail ? { labels: true, threadId: true } : {}) }, { uid: true })) {
          if (!m.source) continue;
          messages.push(
            await parseRawMessage(m.source, {
              id: String(m.uid),
              threadId: m.threadId ?? null,
              labels: m.labels ? [...m.labels] : [],
              date: m.internalDate ? new Date(m.internalDate) : undefined,
            }),
          );
        }
      }
      const last = uids.at(-1) ?? Number(prevUid ?? 0);
      return { messages, cursor: `${validity}:${last}` };
    } finally {
      lock.release();
    }
  }

  async addLabel(id: string, label: string): Promise<void> {
    const c = await this.conn();
    const lock = await c.getMailboxLock('INBOX');
    try {
      if (this.isGmail) await c.messageFlagsAdd(id, [label], { uid: true, useLabels: true });
      else await c.messageFlagsAdd(id, [`$${label.replace(/[^\w]/gu, '_')}`], { uid: true });
    } finally {
      lock.release();
    }
  }

  async listSent(max: number): Promise<RawEmail[]> {
    const c = await this.conn();
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === '\\Sent')?.path ?? (this.isGmail ? '[Gmail]/Sent Mail' : 'Sent');
    const lock = await c.getMailboxLock(sent);
    try {
      const uids = ((await c.search({ since: new Date(Date.now() - 365 * 86_400_000) }, { uid: true })) || []).slice(-max);
      const out: RawEmail[] = [];
      if (uids.length) for await (const m of c.fetch(uids, { uid: true, source: true }, { uid: true })) if (m.source) out.push(await parseRawMessage(m.source, { id: String(m.uid) }));
      return out;
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    await this.client?.logout().catch(() => undefined);
    this.client = null;
  }
}
