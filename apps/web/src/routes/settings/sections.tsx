import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TASK_NAMES, TASK_TIER, UI_LANGUAGES, type Settings } from '@jobhunter/shared';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { ClaudeAccount } from '../../components/ClaudeAccount';
import { api } from '../../lib/api';
import { formatUsd } from '../../lib/format';
import type { SettingsPatch } from '../../lib/settings';

export interface SectionProps {
  s: Settings;
  save: (patch: SettingsPatch) => void;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
};

export function GeneralSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  const appLang = s.applicationLanguage;
  return (
    <Card title={t('settings.general.title')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ui-lang" label={t('settings.general.uiLanguage')}>
          <Select id="ui-lang" value={s.language} onChange={(e) => save({ language: e.target.value as Settings['language'] })}>
            {UI_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="app-lang" label={t('settings.general.applicationLanguage')} hint={t('settings.general.applicationLanguageHint')}>
          <Select id="app-lang" value={appLang} onChange={(e) => save({ applicationLanguage: e.target.value })}>
            <option value="posting">{t('settings.general.langPosting')}</option>
            <option value="ui">{t('settings.general.langUi')}</option>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
              <option key={code} value={`fixed:${code}`}>
                {t('settings.general.langFixed', { lang: name })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

export function ClaudeSection() {
  const { t } = useTranslation();
  return (
    <Card title={t('settings.claude.title')}>
      <ClaudeAccount />
    </Card>
  );
}

export function ModelsSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card title={t('settings.models.title')}>
      <p className="m-0 text-[13px] text-ink-3">{t('settings.models.hint')}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {(['small', 'strong', 'strongest'] as const).map((tier) => (
          <Field key={tier} id={`tier-${tier}`} label={t(`settings.models.tier.${tier}`)}>
            <Input
              id={`tier-${tier}`}
              defaultValue={s.tierModels[tier]}
              onBlur={(e) => e.target.value && e.target.value !== s.tierModels[tier] && save({ tierModels: { [tier]: e.target.value } })}
            />
          </Field>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{t('settings.models.perTask')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {TASK_NAMES.filter((n) => n !== 'connection_test').map((task) => (
            <Field key={task} id={`route-${task}`} label={`${t(`tasks.${task}`)} (${t(`settings.models.tier.${TASK_TIER[task]}`)})`}>
              <Input
                id={`route-${task}`}
                placeholder={s.tierModels[TASK_TIER[task]]}
                defaultValue={s.modelRouting[task] ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (s.modelRouting[task] ?? '')) save({ modelRouting: { ...s.modelRouting, [task]: v || undefined } });
                }}
              />
            </Field>
          ))}
        </div>
      </details>
    </Card>
  );
}

interface UsageResponse {
  totalUsd: number;
  budgetUsd: number | null;
  mode: string;
  byTask: { task: string; runs: number; costUsd: number }[];
}

export function BudgetSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<UsageResponse>('/api/usage') });
  const [value, setValue] = useState(s.monthlyBudgetUsd?.toString() ?? '');
  return (
    <Card title={t('settings.budget.title')}>
      <p className="m-0 text-[13px] text-ink-3">{s.auth.mode === 'subscription' ? t('settings.budget.subscriptionNote') : t('settings.budget.hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="budget" label={t('settings.budget.monthly')}>
          <Input id="budget" type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} className="w-40" placeholder={t('settings.budget.none')} />
        </Field>
        <Button onClick={() => save({ monthlyBudgetUsd: value ? Number(value) : null })}>{t('common.save')}</Button>
      </div>
      {usage.data ? (
        <p className="m-0 text-sm">
          {t('settings.budget.spent', { amount: formatUsd(usage.data.totalUsd) })}
          {usage.data.budgetUsd ? ` / ${formatUsd(usage.data.budgetUsd)}` : ''}
        </p>
      ) : null}
    </Card>
  );
}
