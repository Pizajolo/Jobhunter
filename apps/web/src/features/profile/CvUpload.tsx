import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, queryClient } from '../../lib/api';
import { Button, ErrorText, Spinner } from '../../components/ui';
import { useLatestImport } from './api';
import { CvReview } from './CvReview';

/** Upload a CV (PDF/DOCX) or a LinkedIn PDF export, then review what was extracted (spec §5.1 step 3). */
export function CvUpload({ onApplied }: { onApplied?: () => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [linkedin, setLinkedin] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const latest = useLatestImport(uploaded);
  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('kind', linkedin ? 'linkedin_pdf' : 'cv');
      form.append('file', file!);
      return api.post<{ id: number }>('/api/profile/imports', form);
    },
    onSuccess: () => {
      setUploaded(true);
      void queryClient.invalidateQueries({ queryKey: ['profile-import'] });
    },
  });
  const imp = latest.data;
  const showReview = imp?.status === 'review' && imp.extracted;

  if (showReview) {
    return (
      <CvReview
        imp={imp}
        onDone={() => {
          setUploaded(false);
          setFile(null);
          onApplied?.();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) upload.mutate();
        }}
      >
        <label htmlFor={inputId} className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong bg-ground p-5 text-sm">
          <span className="font-semibold">{t('profile.upload.choose')}</span>
          <span className="text-ink-3">{t('profile.upload.formats')}</span>
          <input id={inputId} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={linkedin} onChange={(e) => setLinkedin(e.target.checked)} />
          {t('profile.upload.linkedin')}
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={!file} busy={upload.isPending}>
            {t('profile.upload.submit')}
          </Button>
        </div>
      </form>
      <ErrorText error={upload.error} />
      {imp?.status === 'extracting' ? (
        <p className="m-0 flex items-center gap-2 text-sm text-ink-2" role="status">
          <Spinner small /> {t('profile.upload.extracting', { file: imp.filename })}
        </p>
      ) : null}
      {imp?.status === 'failed' && uploaded ? <ErrorText error={imp.error ?? t('profile.upload.failed')} /> : null}
    </div>
  );
}
