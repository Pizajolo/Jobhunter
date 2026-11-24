import { chromium, type Browser } from 'playwright';

let browser: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({
      headless: true,
      ...(process.env.JOBHUNTER_CHROMIUM_PATH ? { executablePath: process.env.JOBHUNTER_CHROMIUM_PATH } : {}),
    });
    browser.catch(() => {
      browser = null;
    });
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeRenderer(), 60_000);
  idleTimer.unref();
  return browser;
}

export async function closeRenderer(): Promise<void> {
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => undefined);
}

export interface PdfResult {
  pdf: Buffer;
  pages: number;
  bytes: number;
}

/**
 * HTML → PDF with Chromium's print engine (spec §5.4). Text stays text, so PDFs are selectable and
 * ATS-readable. No network: the page may only use inline resources.
 */
export async function htmlToPdf(html: string, paper: 'A4' | 'Letter'): Promise<PdfResult> {
  const b = await getBrowser();
  const context = await b.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true, tagged: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/gu) ?? []).length;
    return { pdf, pages, bytes: pdf.length };
  } finally {
    await context.close();
  }
}
