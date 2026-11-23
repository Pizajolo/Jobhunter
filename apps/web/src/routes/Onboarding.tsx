import clsx from 'clsx';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from '@jobhunter/shared';
import { Button, Card, Field, Select } from '../components/ui';
import { ClaudeAccount } from '../components/ClaudeAccount';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { setUiLanguage } from '../i18n';
import { CvUpload } from '../features/profile/CvUpload';
import { Interview } from '../features/profile/Interview';
import { StyleSamples } from '../features/profile/StyleSamples';
import { SearchProfileEditor } from '../features/search/SearchProfileEditor';
import { EmailConnect } from '../features/email/EmailConnect';
import { LANGUAGE_NAMES } from './settings/sections';
import { useProfile } from '../features/profile/api';

const STEPS = ['welcome', 'claude', 'cv', 'interview', 'style', 'search', 'email'] as const;
type Step = (typeof STEPS)[number];

/** First-run wizard (spec §5.1). Every step after Claude can be skipped and done later. */
export default function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const update = useUpdateSettings();
  const profile = useProfile();
  const [step, setStep] = useState<Step>('welcome');
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]!);
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]!);
  const finish = () =>
    update.mutate(
      { onboardingCompleted: true },
      {
        onSuccess: () => {
          void navigate('/');
        },
      },
    );
  const s = settings.data;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-4 py-8">
      <div className="flex items-center gap-2.5">
        <div aria-hidden="true" className="h-7 w-7 rounded-lg bg-accent" />
        <span className="text-[15px] font-bold">Jobhunter</span>
      </div>
      <ol aria-label={t('onboarding.steps')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {STEPS.map((st, i) => (
          <li key={st}>
            <button
              type="button"
              aria-current={st === step ? 'step' : undefined}
              onClick={() => setStep(st)}
              className={clsx(
                'rounded-full px-3 py-1 text-[12.5px]',
                st === step ? 'bg-accent font-semibold text-on-accent' : i < idx ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-2',
              )}
            >
              {i + 1}. {t(`onboarding.step.${st}`)}
            </button>
          </li>
        ))}
      </ol>

      <Card title={t(`onboarding.title.${step}`)}>
        {step === 'welcome' && s ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-sm text-ink-2">{t('onboarding.welcomeText')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ob-ui-lang" label={t('settings.general.uiLanguage')}>
                <Select
                  id="ob-ui-lang"
                  value={s.language}
                  onChange={(e) => {
                    setUiLanguage(e.target.value);
                    update.mutate({ language: e.target.value as (typeof UI_LANGUAGES)[number] });
                  }}
                >
                  {UI_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_NAMES[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="ob-app-lang" label={t('settings.general.applicationLanguage')} hint={t('settings.general.applicationLanguageHint')}>
                <Select id="ob-app-lang" value={s.applicationLanguage} onChange={(e) => update.mutate({ applicationLanguage: e.target.value })}>
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
          </div>
        ) : null}
        {step === 'claude' ? <ClaudeAccount compact /> : null}
        {step === 'cv' ? (
          <div className="flex flex-col gap-3">
            {profile.data && profile.data.version > 0 ? <p className="m-0 text-sm text-ok-ink">{t('onboarding.cvDone', { count: profile.data.facts.length })}</p> : null}
            <CvUpload onApplied={next} />
          </div>
        ) : null}
        {step === 'interview' ? <Interview onCompleted={next} /> : null}
        {step === 'style' && s ? <StyleSamples defaultLanguage={s.language} /> : null}
        {step === 'search' ? <SearchProfileEditor /> : null}
        {step === 'email' ? <EmailConnect /> : null}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={back} disabled={idx === 0}>
          {t('common.back')}
        </Button>
        <div className="flex gap-2">
          {step !== 'email' ? (
            <>
              {idx > 1 ? <Button onClick={next}>{t('common.skip')}</Button> : null}
              <Button variant="primary" onClick={next}>
                {t('common.next')}
              </Button>
            </>
          ) : (
            <Button variant="primary" busy={update.isPending} onClick={finish}>
              {t('onboarding.finish')}
            </Button>
          )}
        </div>
      </div>
      <button type="button" className="self-start text-[12.5px] text-ink-3 underline" onClick={finish}>
        {t('onboarding.skipAll')}
      </button>
    </div>
  );
}
