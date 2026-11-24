import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, queryClient } from '../../lib/api';
import { useTranslation } from 'react-i18next';
import { CV_COUNTRIES, CV_TEMPLATES, type CvTemplate, type Settings } from '@jobhunter/shared';
import { Card, ErrorText, Field, Select, Spinner, Toggle } from '../../components/ui';
import { useSettings, useUpdateSettings } from '../../lib/settings';

/** CV templates with a live preview using the user's own profile (spec §5.7.7). */
export function TemplatesTab() {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [preview, setPreview] = useState<CvTemplate | null>(null);
  if (!settings.data) return <Spinner />;
  const cv = settings.data.cv;
  const shown = preview ?? cv.template;
  return (
    <Card title={t('profile.tabs.templates')}>
      <CvSettingsFields cv={cv} onChange={(patch) => update.mutate({ cv: patch })} />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('templates.choose')}>
        {CV_TEMPLATES.map((tpl) => (
          <button
            key={tpl}
            type="button"
            role="radio"
            aria-checked={cv.template === tpl}
            onClick={() => {
              setPreview(tpl);
              update.mutate({ cv: { template: tpl } });
            }}
            className={`flex w-48 flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm ${cv.template === tpl ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
          >
            <span className="font-semibold">{t(`templates.${tpl}.name`)}</span>
            <span className="text-[12px] text-ink-3">{t(`templates.${tpl}.desc`)}</span>
          </button>
        ))}
      </div>
      <iframe key={`${shown}-${cv.paper}-${cv.photo}`} title={t('templates.preview')} src={`/api/templates/${shown}/preview.pdf`} className="h-[75vh] w-full rounded-[10px] border border-line bg-white" />
    </Card>
  );
}

export function CvSettingsFields({ cv, onChange }: { cv: Settings['cv']; onChange: (patch: Partial<Settings['cv']>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="cv-country" label={t('templates.country')} hint={t(`templates.countryNote.${cv.country}`)}>
          <Select id="cv-country" value={cv.country} onChange={(e) => onChange({ country: e.target.value as Settings['cv']['country'], paper: e.target.value === 'US' || e.target.value === 'MX' ? 'Letter' : 'A4' })}>
            {CV_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {t(`templates.countries.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cv-paper" label={t('templates.paper')}>
          <Select id="cv-paper" value={cv.paper} onChange={(e) => onChange({ paper: e.target.value as 'A4' | 'Letter' })}>
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </Select>
        </Field>
        <Field id="cv-pages" label={t('templates.pages')}>
          <Select id="cv-pages" value={cv.pages} onChange={(e) => onChange({ pages: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>{t('templates.onePage')}</option>
            <option value={2}>{t('templates.twoPages')}</option>
          </Select>
        </Field>
      </div>
      <Toggle checked={cv.photo} onChange={(v) => onChange({ photo: v })} label={t('templates.photo')} description={t('templates.photoHint')} />
      {cv.photo ? <PhotoUpload /> : null}
    </div>
  );
}

function PhotoUpload() {
  const { t } = useTranslation();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return api.post('/api/profile/photo', form);
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="photo-upload" className="text-[13px] font-medium text-ink-2">
        {t('templates.uploadPhoto')}
      </label>
      <input id="photo-upload" type="file" accept="image/jpeg,image/png" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      {upload.isSuccess ? <span className="text-[12.5px] text-ok-ink">{t('common.saved')}</span> : null}
      <ErrorText error={upload.error} />
    </div>
  );
}
