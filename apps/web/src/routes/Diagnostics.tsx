import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/ui';

export default function Diagnostics() {
  const { t } = useTranslation();
  return <PageHeader title={t('pages.diagnostics')} />;
}
