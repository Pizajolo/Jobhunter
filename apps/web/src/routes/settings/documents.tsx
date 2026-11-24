import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui';
import { CvSettingsFields } from '../../features/documents/TemplatesTab';
import type { SectionProps } from './sections';

export function CvSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card title={t('templates.settingsTitle')}>
      <CvSettingsFields cv={s.cv} onChange={(patch) => save({ cv: patch })} />
      <p className="m-0 text-[12.5px] text-ink-3">{t('templates.settingsHint')}</p>
    </Card>
  );
}
