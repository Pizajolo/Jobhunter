import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';

interface Usage {
  dataDir: string;
  dbBytes: number;
  fileBytes: number;
  browserProfileBytes: number;
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(n < 10_485_760 ? 1 : 0)} MB`;

/** Your data (spec §2.7): where it lives, export as a zip, delete everything. */
export function DataSection() {
  const { t } = useTranslation();
  const usage = useQuery({ queryKey: ['data-usage'], queryFn: () => api.get<Usage>('/api/data/usage') });
  const [confirm, setConfirm] = useState('');
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.post('/api/data/delete-all', { confirm }),
    onSuccess: () => window.location.assign('/onboarding'),
  });
  const u = usage.data;
  return (
    <Card title={t('data.title')}>
      <p className="m-0 text-[13.5px] text-ink-2">{t('data.intro')}</p>
      {u ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-ink-2">{t('data.folder')}</dt>
          <dd className="m-0 break-all font-mono text-[12.5px]">{u.dataDir}</dd>
          <dt className="text-ink-2">{t('data.size')}</dt>
          <dd className="m-0">{t('data.sizeValue', { db: mb(u.dbBytes), files: mb(u.fileBytes), browser: mb(u.browserProfileBytes) })}</dd>
        </dl>
      ) : null}
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div>
          <a className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink no-underline hover:bg-sunken" href="/api/data/export" download>
            {t('data.export')}
          </a>
        </div>
        <p className="m-0 text-[12.5px] text-ink-3">{t('data.exportHint')}</p>
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        {!open ? (
          <div>
            <Button variant="danger" onClick={() => setOpen(true)}>
              {t('data.delete')}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 rounded-lg border border-line-strong p-3"
            onSubmit={(e) => {
              e.preventDefault();
              del.mutate();
            }}
          >
            <p className="m-0 text-[13.5px]">{t('data.deleteWarning')}</p>
            <Field id="delete-confirm" label={t('data.deleteConfirm')}>
              <Input id="delete-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" busy={del.isPending} disabled={confirm !== 'DELETE'}>
                {t('data.deleteNow')}
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  setConfirm('');
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
            <ErrorText error={del.error} />
          </form>
        )}
      </div>
    </Card>
  );
}
