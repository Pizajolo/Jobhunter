import { useTranslation } from 'react-i18next';
import { ErrorText, PageHeader, Spinner } from '../components/ui';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { setUiLanguage } from '../i18n';
import { BudgetSection, ClaudeSection, GeneralSection, ModelsSection } from './settings/sections';
import { extraSections } from './settings/registry';

export default function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!settings.data) return <Spinner />;
  const s = settings.data;
  const save: Parameters<typeof GeneralSection>[0]['save'] = (patch) => {
    if (patch.language) setUiLanguage(patch.language);
    update.mutate(patch);
  };
  return (
    <>
      <PageHeader title={t('pages.settings')} subtitle={update.isSuccess ? t('common.saved') : undefined} />
      <ErrorText error={update.error} />
      <div className="flex max-w-4xl flex-col gap-4">
        <GeneralSection s={s} save={save} />
        <ClaudeSection />
        <ModelsSection s={s} save={save} />
        <BudgetSection s={s} save={save} />
        {extraSections.map((Section, i) => (
          <Section key={i} s={s} save={save} />
        ))}
      </div>
    </>
  );
}
