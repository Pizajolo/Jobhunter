/** A message as Jobhunter sees it. Bodies are used in memory for classification and never stored. */
export interface RawEmail {
  providerMessageId: string;
  threadId: string | null;
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  receivedAt: string;
  text: string;
  html: string | null;
  labels: string[];
}

export interface SyncResult {
  messages: RawEmail[];
  /** Opaque cursor to resume from (Gmail historyId, IMAP UID). */
  cursor: string;
}

/** Spec §5.5: one interface, Gmail API and IMAP adapters (room for Outlook / Microsoft Graph later). */
export interface EmailProvider {
  readonly kind: 'gmail_api' | 'imap';
  /** Messages newer than the cursor; with no cursor, the last `initialDays` days. */
  sync(cursor: string | null, opts: { initialDays: number; max: number }): Promise<SyncResult>;
  /** Apply a label (Gmail label or IMAP X-GM-LABELS); creates it if needed. */
  addLabel(providerMessageId: string, label: string): Promise<void>;
  /** Recent sent messages for writing-style samples (opt-in). */
  listSent(max: number): Promise<RawEmail[]>;
  /** Cheap check that credentials work; returns the account address. */
  verify(): Promise<string>;
  close(): Promise<void>;
}
