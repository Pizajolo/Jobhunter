import { useState, type ComponentType } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@jobhunter/shared';
import { Button, Card, ErrorText, Field, Input, PageHeader, Spinner, Tabs, Textarea } from '../components/ui';
import { api, queryClient } from '../lib/api';
import { useSettings } from '../lib/settings';
import { useProfile } from '../features/profile/api';
import { CvUpload } from '../features/profile/CvUpload';
import { FactsList } from '../features/profile/FactsList';
import { Interview } from '../features/profile/Interview';
import { StyleSamples } from '../features/profile/StyleSamples';
import { TemplatesTab } from '../features/documents/TemplatesTab';

type Tab = 'overview' | 'facts' | 'interview' | 'style' | 'templates';

function Preferences({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const [p, setP] = useState(profile.preferences);
  const save = useMutation({
    mutationFn: () => api.put('/api/profile', { profile: { ...profile, preferences: p } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
  const fields = ['workAuthorization', 'salaryExpectation', 'noticePeriod'] as const;
  return (
    <Card title={t('profile.preferences.title')}>
      <p className="m-0 text-[13px] text-ink-3">{t('profile.preferences.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <Field key={f} id={`pref-${f}`} label={t(`profile.fields.${f}`)}>
            <Input id={`pref-${f}`} value={p[f] ?? ''} onChange={(e) => setP({ ...p, [f]: e.target.value || undefined })} />
          </Field>
        ))}
      </div>
      <Field id="pref-motivation" label={t('profile.fields.motivation')}>
        <Textarea id="pref-motivation" rows={3} value={p.motivation ?? ''} onChange={(e) => setP({ ...p, motivation: e.target.value || undefined })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.willingToRelocate ?? false} onChange={(e) => setP({ ...p, willingToRelocate: e.target.checked })} />
        {t('profile.fields.willingToRelocate')}
      </label>
      <div>
        <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}

function Overview({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Card title={profile.basics.name || t('profile.overview.empty')}>
        {profile.basics.label ? <p className="m-0 text-sm text-ink-2">{profile.basics.label}</p> : null}
        {profile.basics.summary ? <p className="m-0 text-sm">{profile.basics.summary}</p> : null}
        {profile.work.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">{t('profile.sections.work')}</h3>
            {profile.work.map((w) => (
              <div key={w.id} className="text-[13.5px]">
                <span className="font-medium">{w.position}</span> · {w.name}{' '}
                <span className="text-ink-3">
                  {w.startDate ?? ''} – {w.endDate ?? t('profile.overview.present')}
                </span>
                <ul className="m-0 pl-5 text-ink-2">
                  {w.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {profile.education.length ? (
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-sm font-semibold">{t('profile.sections.education')}</h3>
            {profile.education.map((e) => (
              <div key={e.id} className="text-[13.5px]">
                {[e.studyType, e.area].filter(Boolean).join(' ')} · {e.institution}
              </div>
            ))}
          </div>
        ) : null}
        {profile.skills.length ? (
          <p className="m-0 text-[13.5px]">
            <strong>{t('profile.sections.skills')}:</strong> {profile.skills.map((s) => s.name).join(', ')}
          </p>
        ) : null}
        {profile.languages.length ? (
          <p className="m-0 text-[13.5px]">
            <strong>{t('profile.sections.languages')}:</strong> {profile.languages.map((l) => `${l.language}${l.fluency ? ` (${l.fluency})` : ''}`).join(', ')}
          </p>
        ) : null}
      </Card>
      <Preferences profile={profile} />
      <Card title={t('profile.upload.title')}>
        <CvUpload />
      </Card>
    </div>
  );
}

const TemplatesTabComponent: ComponentType = TemplatesTab;

export default function ProfilePage() {
  const { t } = useTranslation();
  const profile = useProfile();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('overview');
  if (!profile.data || !settings.data) return <Spinner />;
  return (
    <>
      <PageHeader title={t('pages.profile')} subtitle={t('profile.subtitle', { version: profile.data.version, facts: profile.data.facts.filter((f) => f.confirmedAt).length })} />
      <Tabs<Tab>
        label={t('pages.profile')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('profile.tabs.overview') },
          { id: 'facts', label: t('profile.tabs.facts') },
          { id: 'interview', label: t('profile.tabs.interview') },
          { id: 'style', label: t('profile.tabs.style') },
          { id: 'templates', label: t('profile.tabs.templates') },
        ]}
      />
      <div role="tabpanel" className="max-w-5xl">
        {tab === 'overview' ? <Overview profile={profile.data.profile} /> : null}
        {tab === 'facts' ? (
          <Card>
            <FactsList facts={profile.data.facts} />
          </Card>
        ) : null}
        {tab === 'interview' ? (
          <Card title={t('profile.tabs.interview')}>
            <Interview />
          </Card>
        ) : null}
        {tab === 'style' ? (
          <Card title={t('profile.tabs.style')}>
            <StyleSamples defaultLanguage={settings.data.language} />
          </Card>
        ) : null}
        {tab === 'templates' ? <TemplatesTabComponent /> : null}
      </div>
    </>
  );
}
