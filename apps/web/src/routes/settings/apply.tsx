import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PERMANENT_AUTO_APPLY_EXCLUSIONS, type AutoApplyLevel } from '@jobhunter/shared';
import { Badge, Button, Card, Field, Input, Toggle } from '../../components/ui';
import type { SectionProps } from './sections';

const LEVELS: AutoApplyLevel[] = ['off', 'prepare', 'submit'];

/** Auto-apply policy (spec §5.6). Default: prepare only. */
export function ApplySection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState('');
  const a = s.autoApply;
  return (
    <Card title={t('apply.settings.title')}>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium text-ink-2">{t('apply.settings.level')}</legend>
        {LEVELS.map((l) => (
          <label key={l} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="radio" name="apply-level" className="mt-1" checked={a.level === l} onChange={() => save({ autoApply: { level: l } })} />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {t(`apply.levels.${l}.title`)} {l === 'prepare' ? <Badge kind="info">{t('claude.default')}</Badge> : null}
              </span>
              <span className="text-[12.5px] text-ink-3">{t(`apply.levels.${l}.desc`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {a.level === 'submit' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="min-score" label={t('apply.settings.minScore')}>
            <Input id="min-score" type="number" min={0} max={100} defaultValue={a.minScore} onBlur={(e) => save({ autoApply: { minScore: Number(e.target.value) } })} />
          </Field>
          <Field id="daily-cap" label={t('apply.settings.dailyCap')}>
            <Input id="daily-cap" type="number" min={0} max={50} defaultValue={a.dailyCap} onBlur={(e) => save({ autoApply: { dailyCap: Number(e.target.value) } })} />
          </Field>
        </div>
      ) : null}
      <Toggle checked={a.autoApprovePackages} onChange={(v) => save({ autoApply: { autoApprovePackages: v } })} label={t('apply.settings.autoApprove')} description={t('apply.settings.autoApproveHint')} />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-ink-2">{t('apply.settings.excluded')}</span>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {[...new Set([...PERMANENT_AUTO_APPLY_EXCLUSIONS, ...a.excludedDomains])].map((d) => {
            const locked = (PERMANENT_AUTO_APPLY_EXCLUSIONS as readonly string[]).includes(d);
            return (
              <li key={d} className="flex items-center gap-1 rounded-full bg-sunken px-3 py-1 text-[13px]">
                {d}
                {locked ? (
                  <span className="text-[11.5px] text-ink-3">({t('apply.settings.always')})</span>
                ) : (
                  <button type="button" aria-label={`${t('common.remove')} ${d}`} className="text-ink-3" onClick={() => save({ autoApply: { excludedDomains: a.excludedDomains.filter((x) => x !== d) } })}>
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = domain.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/\/.*$/u, '');
            if (v) save({ autoApply: { excludedDomains: [...new Set([...a.excludedDomains, v])] } });
            setDomain('');
          }}
        >
          <label htmlFor="exclude-domain" className="sr-only">
            {t('apply.settings.addDomain')}
          </label>
          <Input id="exclude-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="max-w-xs" />
          <Button type="submit">{t('common.add')}</Button>
        </form>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">{t('apply.settings.responsibility')}</p>
    </Card>
  );
}
