import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/ui';

export default function JobDetail() {
  const { t } = useTranslation();
  return <PageHeader title={t('pages.job_detail')} />;
}
