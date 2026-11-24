import { chromium, type BrowserContext, type Page } from 'playwright';
import { USER_AGENT } from '@jobhunter/shared';

/**
 * One persistent Chromium profile per user (spec §5.6): portal logins the user makes in this browser
 * survive restarts. Visible on desktop, headless in server mode.
 */
export class BrowserSession {
  private ctx: Promise<BrowserContext> | null = null;

  constructor(
    private readonly profileDir: string,
    private readonly headless: boolean,
  ) {}

  private context(): Promise<BrowserContext> {
    if (!this.ctx) {
      this.ctx = chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        viewport: { width: 1280, height: 900 },
        userAgent: undefined,
        acceptDownloads: false,
        ...(process.env.JOBHUNTER_CHROMIUM_PATH ? { executablePath: process.env.JOBHUNTER_CHROMIUM_PATH } : {}),
      });
      this.ctx.then((c) => c.on('close', () => (this.ctx = null))).catch(() => (this.ctx = null));
    }
    return this.ctx;
  }

  async newPage(): Promise<Page> {
    const c = await this.context();
    const page = await c.newPage();
    await page.setExtraHTTPHeaders({ 'X-Requested-By': USER_AGENT.split(' ')[0]! }).catch(() => undefined);
    return page;
  }

  /** Open a page for the user to log in to a portal themselves (Jobhunter never types passwords). */
  async openForUser(url: string): Promise<void> {
    const p = await this.newPage();
    await p.goto(url).catch(() => undefined);
  }

  async close(): Promise<void> {
    const c = this.ctx;
    this.ctx = null;
    if (c) await (await c).close().catch(() => undefined);
  }
}
