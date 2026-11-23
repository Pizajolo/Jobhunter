import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui';

export function TemplatesTab() {
  const { t } = useTranslation();
  return <Card title={t('profile.tabs.templates')}>{null}</Card>;
}
