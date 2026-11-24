import type { Page } from 'playwright';
import { findApplyEntry, findNext, findSubmit, readForm, type FormField } from './form.js';
import { detectBlocker, looksSubmitted, type StopReason } from './safety.js';
import { mapFields, type ApplyData, type FieldValue } from './mapping.js';

export interface FilledField {
  step: number;
  label: string;
  kind: FormField['kind'];
  required: boolean;
  value: string | null;
  source: string | null;
}

export interface PrepareResult {
  blocker: StopReason | null;
  fields: FilledField[];
  unresolvedRequired: FilledField[];
  steps: number;
  readyToSubmit: boolean;
  url: string;
}

export interface PrepareOptions {
  url: string;
  data: ApplyData;
  /** Optional model-backed mapping of fields the rules couldn't map (approved answers only). */
  mapUnresolved?: (fields: FormField[]) => Promise<Map<string, FieldValue>>;
  maxSteps?: number;
  timeoutMs?: number;
}

async function fill(page: Page, f: FormField, v: FieldValue): Promise<boolean> {
  const loc = page.locator(`[data-jh-id="${f.id}"]`);
  try {
    if (v.kind === 'file') await loc.setInputFiles(v.path);
    else if (f.kind === 'select') await loc.selectOption({ label: v.value });
    else if (f.kind === 'radio') {
      const count = await loc.count();
      for (let i = 0; i < count; i++) {
        const r = loc.nth(i);
        await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
        const label = await r.evaluate((el) => (el.closest('label')?.textContent ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : '') ?? '').trim());
        if (label.toLowerCase() === v.value.toLowerCase()) {
          await r.check();
          return true;
        }
      }
      return false;
    } else if (f.kind === 'checkbox') {
      if (v.value === 'true') await loc.check();
    } else await loc.fill(v.value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the application, fill every field it can from approved data, walk through multi-step forms,
 * and stop before the final submit. Never submits; never types passwords; stops on any blocker.
 */
export async function prepareApplication(page: Page, o: PrepareOptions): Promise<PrepareResult> {
  const timeout = o.timeoutMs ?? 30_000;
  page.setDefaultTimeout(timeout);
  const all: FilledField[] = [];
  const result = (blocker: StopReason | null, steps: number, ready: boolean): PrepareResult => ({
    blocker,
    fields: all,
    unresolvedRequired: all.filter((f) => f.required && f.value === null),
    steps,
    readyToSubmit: ready,
    url: page.url(),
  });
  const res = await page.goto(o.url, { waitUntil: 'domcontentloaded' });
  if (res && res.status() >= 400) return result('error_page', 0, false);
  await page.waitForLoadState('load').catch(() => undefined);
  let blocker = await detectBlocker(page);
  if (blocker) return result(blocker, 0, false);

  let fields = await readForm(page);
  if (fields.length === 0) {
    const entry = await findApplyEntry(page);
    if (!entry) return result('no_form', 0, false);
    await Promise.all([page.waitForLoadState('load').catch(() => undefined), entry.click()]);
    await page.waitForTimeout(300);
    blocker = await detectBlocker(page);
    if (blocker) return result(blocker, 0, false);
    fields = await readForm(page);
    if (fields.length === 0) return result('no_form', 0, false);
  }

  const seen = new Set<string>();
  for (let step = 1; step <= (o.maxSteps ?? 8); step++) {
    const fresh = fields.filter((f) => !seen.has(`${f.name}|${f.label}`));
    const { values, unresolved } = mapFields(fresh, o.data);
    if (unresolved.length && o.mapUnresolved) {
      const extra = await o.mapUnresolved(unresolved);
      for (const [id, v] of extra) values.set(id, v);
    }
    for (const f of fresh) {
      seen.add(`${f.name}|${f.label}`);
      const v = values.get(f.id);
      const ok = v ? await fill(page, f, v) : false;
      all.push({ step, label: f.label, kind: f.kind, required: f.required, value: ok && v ? (v.kind === 'file' ? v.path.split(/[\\/]/u).pop()! : v.value) : null, source: ok && v ? v.source : null });
    }
    blocker = await detectBlocker(page);
    if (blocker) return result(blocker, step, false);
    const next = await findNext(page);
    const submit = await findSubmit(page);
    if (!next || (submit && !(await next.isVisible()))) {
      return result(null, step, !!submit);
    }
    const before = (await readForm(page)).map((f) => f.label).join('|');
    await next.click();
    await page.waitForTimeout(400);
    fields = await readForm(page);
    if (fields.map((f) => f.label).join('|') === before) {
      // the form refused to advance (a required field we couldn't fill)
      return result(null, step, false);
    }
  }
  return result('unexpected', o.maxSteps ?? 8, false);
}

/** Click the final submit button and confirm the application went through. */
export async function submitApplication(page: Page): Promise<{ submitted: boolean; blocker: StopReason | null }> {
  const blocker = await detectBlocker(page);
  if (blocker) return { submitted: false, blocker };
  const submit = await findSubmit(page);
  if (!submit) return { submitted: false, blocker: 'unexpected' };
  await submit.click();
  await page.waitForLoadState('load').catch(() => undefined);
  for (let i = 0; i < 20; i++) {
    if (await looksSubmitted(page)) return { submitted: true, blocker: null };
    const b = await detectBlocker(page);
    if (b) return { submitted: false, blocker: b };
    await page.waitForTimeout(250);
  }
  return { submitted: false, blocker: 'unexpected' };
}
