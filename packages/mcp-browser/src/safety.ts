import type { Page } from 'playwright';
import { ensurePageShims } from './form.js';

export type StopReason =
  | 'captcha'
  | 'login'
  | 'two_factor'
  | 'payment'
  | 'error_page'
  | 'excluded_site'
  | 'unknown_fields'
  | 'no_form'
  | 'not_approved'
  | 'policy'
  | 'unexpected';

/**
 * Spec §2.5: always stop and hand over on CAPTCHAs, login walls, two-factor prompts, payment fields
 * or anything unexpected. Jobhunter never tries to get past bot detection.
 */
export async function detectBlocker(page: Page): Promise<StopReason | null> {
  await ensurePageShims(page);
  return page.evaluate(() => {
    const visible = (el: Element | null) => {
      if (!el) return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
    };
    const html = document.documentElement.innerHTML.toLowerCase();
    const text = (document.body?.innerText ?? '').toLowerCase();
    const captchaSel = ['.g-recaptcha', '.h-captcha', '.cf-turnstile', '#challenge-form', '#cf-challenge-running', '[data-sitekey]', 'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="challenges.cloudflare.com"]', 'iframe[title*="captcha" i]'];
    if (captchaSel.some((s) => [...document.querySelectorAll(s)].some(visible)) || /verify (that )?you are (a )?human|are you a robot|security check|press (&|and) hold/u.test(text)) return 'captcha';
    if ([...document.querySelectorAll('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="2fa" i]')].some(visible) || /verification code|two-factor|2-step|bestätigungscode|code de vérification/u.test(text)) return 'two_factor';
    if ([...document.querySelectorAll('input[autocomplete^="cc-"], input[name*="card" i][name*="number" i], iframe[src*="stripe"], iframe[src*="paypal"]')].some(visible) || /card number|kreditkarte|numéro de carte|número de tarjeta/u.test(text)) return 'payment';
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return 'login';
    if (/^(404|403|500|502|503)\b|page not found|access denied|seite nicht gefunden|this job is no longer available|position has been filled/u.test(text.trim().slice(0, 300)) || html.length < 200) return 'error_page';
    return null;
  });
}

export async function looksSubmitted(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  return /thank you for (applying|your application)|application (has been )?(received|submitted)|we('| ha)ve received your application|vielen dank für (ihre|deine) bewerbung|bewerbung (ist )?eingegangen|merci pour votre candidature|gracias por (tu|su) (solicitud|candidatura)|obrigad[oa] pela (sua|tua) candidatura|grazie per la (tua|sua) candidatura/u.test(text);
}
