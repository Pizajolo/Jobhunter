import { useTranslation } from 'react-i18next';
import { Card, Field, Input } from '../../components/ui';
import { EmailConnect } from '../../features/email/EmailConnect';
import type { SectionProps } from './sections';

export function EmailSection({ s, save }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card title={t('email.settingsTitle')}>
      <div id="email" />
      <EmailConnect />
      <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
        <Field id="email-interval" label={t('email.syncInterval')}>
          <Input id="email-interval" type="number" min={1} defaultValue={s.email.syncIntervalMinutes} onBlur={(e) => save({ email: { syncIntervalMinutes: Number(e.target.value) } })} />
        </Field>
        <Field id="email-conf" label={t('email.reviewConfidence')} hint={t('email.reviewConfidenceHint')}>
          <Input id="email-conf" type="number" min={0.5} max={1} step={0.05} defaultValue={s.emailReviewConfidence} onBlur={(e) => save({ emailReviewConfidence: Number(e.target.value) })} />
        </Field>
        <Field id="no-response" label={t('email.noResponseDays')} hint={t('email.noResponseHint')}>
          <Input id="no-response" type="number" min={1} defaultValue={s.noResponseAfterDays} onBlur={(e) => save({ noResponseAfterDays: Number(e.target.value) })} />
        </Field>
      </div>
    </Card>
  );
}
