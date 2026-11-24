import type { Page } from 'playwright';

export interface FormField {
  /** Stable id assigned in the page (data-jh-id). */
  id: string;
  kind: 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'password';
  label: string;
  name: string;
  required: boolean;
  options: string[];
  value: string;
}

/**
 * Read the visible form controls of the current page and tag them with data-jh-id so they can be
 * filled later. Labels come from <label for>, wrapping labels, aria attributes, legends or placeholders.
 */
/**
 * Code passed to page.evaluate is serialised from our source. When the engine runs through tsx/esbuild
 * with keepNames, helpers get wrapped in __name(); define a no-op so they work inside the page.
 */
export async function ensurePageShims(page: Page): Promise<void> {
  await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
}

export async function readForm(page: Page): Promise<FormField[]> {
  await ensurePageShims(page);
  return page.evaluate(() => {
    // File inputs are often visually hidden inside a visible drop zone, so check their container.
    const visible = (el: Element): boolean => {
      const target = (el as HTMLInputElement).type === 'file' ? (el.parentElement ?? el) : el;
      return target.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('[hidden], [aria-hidden="true"]');
    };
    const clean = (s: string | null | undefined) => (s ?? '').replace(/[\s\u00a0]+/gu, ' ').replace(/[*✱]/gu, '').trim();
    const labelOf = (el: HTMLElement): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return clean(l.textContent);
      }
      const wrap = el.closest('label');
      if (wrap) {
        const clone = wrap.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('input, select, textarea').forEach((x) => x.remove());
        const t = clean(clone.textContent);
        if (t) return t;
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return clean(aria);
      const by = el.getAttribute('aria-labelledby');
      if (by) return clean(by.split(' ').map((i) => document.getElementById(i)?.textContent).join(' '));
      return clean(el.getAttribute('placeholder') ?? el.getAttribute('name'));
    };
    // Re-tag from scratch: earlier steps of a multi-step form keep their (hidden) controls.
    document.querySelectorAll('[data-jh-id]').forEach((el) => el.removeAttribute('data-jh-id'));
    const fields: unknown[] = [];
    const radios = new Map<string, HTMLInputElement[]>();
    let n = 0;
    const controls = [...document.querySelectorAll('input, textarea, select')] as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    for (const el of controls) {
      if (!visible(el)) continue;
      const type = el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
      if (type === 'radio') {
        const key = el.name || `radio-${n}`;
        radios.set(key, [...(radios.get(key) ?? []), el as HTMLInputElement]);
        continue;
      }
      const id = `f${n++}`;
      el.setAttribute('data-jh-id', id);
      const required = el.required || el.getAttribute('aria-required') === 'true' || /\*|✱/u.test(labelOf(el) + (document.querySelector(`label[for="${CSS.escape(el.id || '_')}"]`)?.textContent ?? '') + (el.closest('label')?.textContent ?? ''));
      fields.push({
        id,
        kind: ['text', 'email', 'tel', 'url', 'number', 'date', 'checkbox', 'file', 'password', 'textarea', 'select'].includes(type) ? type : 'text',
        label: labelOf(el),
        name: el.name,
        required,
        options: el instanceof HTMLSelectElement ? [...el.options].filter((o) => o.value !== '').map((o) => clean(o.textContent)) : [],
        value: el instanceof HTMLInputElement && (type === 'checkbox' || type === 'file') ? '' : el.value,
      });
    }
    for (const [name, group] of radios) {
      const id = `f${n++}`;
      group.forEach((r) => r.setAttribute('data-jh-id', id));
      const legend = group[0]!.closest('fieldset')?.querySelector('legend')?.textContent;
      const options = group.map((r) => labelOf(r));
      fields.push({ id, kind: 'radio', label: clean(legend) || name, name, required: group.some((r) => r.required), options, value: group.find((r) => r.checked) ? labelOf(group.find((r) => r.checked)!) : '' });
    }
    return fields as never;
  });
}

const SUBMIT_TEXT = /^(submit|submit application|apply|send|send application|absenden|bewerbung absenden|jetzt bewerben|envoyer|postuler|enviar|enviar candidatura|candidatar|invia)\b/iu;
const NEXT_TEXT = /^(next|continue|save and continue|weiter|suivant|continuer|siguiente|continuar|próximo|avanti)\b/iu;
const APPLY_ENTRY = /^(apply|apply now|apply for this (job|position|role)|jetzt bewerben|bewerben|postuler|aplicar|candidatar(-se)?|candidati)\b/iu;

async function visibleButtons(page: Page) {
  const loc = page.locator('button, input[type="submit"], a[role="button"], [role="button"]');
  const out: { index: number; text: string; type: string }[] = [];
  const count = await loc.count();
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible())) continue;
    const text = ((await el.innerText().catch(() => '')) || (await el.getAttribute('value')) || (await el.getAttribute('aria-label')) || '').trim();
    out.push({ index: i, text, type: (await el.getAttribute('type')) ?? '' });
  }
  return { loc, out };
}

export async function findSubmit(page: Page) {
  const { loc, out } = await visibleButtons(page);
  const hit = out.find((b) => SUBMIT_TEXT.test(b.text) && !NEXT_TEXT.test(b.text)) ?? out.find((b) => b.type === 'submit' && !NEXT_TEXT.test(b.text));
  return hit ? loc.nth(hit.index) : null;
}

export async function findNext(page: Page) {
  const { loc, out } = await visibleButtons(page);
  const hit = out.find((b) => NEXT_TEXT.test(b.text));
  return hit ? loc.nth(hit.index) : null;
}

/** On a posting page without a form: the "Apply" link or button. */
export async function findApplyEntry(page: Page) {
  const links = page.locator('a, button');
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const el = links.nth(i);
    if (!(await el.isVisible())) continue;
    const text = (await el.innerText().catch(() => '')).trim();
    if (APPLY_ENTRY.test(text)) return el;
  }
  return null;
}
