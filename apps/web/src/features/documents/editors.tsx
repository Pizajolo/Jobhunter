import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoverLetter, FormAnswer, TailoredCv } from '@jobhunter/shared';
import { Badge, Button, Input, Textarea } from '../../components/ui';

export function LetterView({ letter }: { letter: CoverLetter }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-ground px-5 py-4 text-sm leading-relaxed">
      <p className="m-0">{letter.greeting}</p>
      {letter.paragraphs.map((p, i) => (
        <p key={i} className="m-0">
          {p.text}
        </p>
      ))}
      <p className="m-0">{letter.closing}</p>
    </div>
  );
}

export function LetterEditor({ letter, onSave, onCancel, busy }: { letter: CoverLetter; onSave: (l: CoverLetter) => void; onCancel: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const [l, setL] = useState(letter);
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1 text-[12.5px] text-ink-3">
        {t('docs.greeting')}
        <Input value={l.greeting} onChange={(e) => setL({ ...l, greeting: e.target.value })} />
      </label>
      {l.paragraphs.map((p, i) => (
        <label key={i} className="flex flex-col gap-1 text-[12.5px] text-ink-3">
          {t('docs.paragraph', { n: i + 1 })}
          <Textarea rows={4} value={p.text} onChange={(e) => setL({ ...l, paragraphs: l.paragraphs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
        </label>
      ))}
      <label className="flex flex-col gap-1 text-[12.5px] text-ink-3">
        {t('docs.closing')}
        <Input value={l.closing} onChange={(e) => setL({ ...l, closing: e.target.value })} />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" busy={busy} onClick={() => onSave({ ...l, paragraphs: l.paragraphs.filter((p) => p.text.trim()) })}>
          {t('common.save')}
        </Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

export function CvEditor({ cv, onSave, onCancel, busy }: { cv: TailoredCv; onSave: (c: TailoredCv) => void; onCancel: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const [c, setC] = useState(cv);
  const setBullets = (si: number, ii: number, text: string) => {
    const lines = text.split('\n');
    setC({
      ...c,
      sections: c.sections.map((s, a) =>
        a !== si
          ? s
          : {
              ...s,
              items: s.items.map((it, b) => (b !== ii ? it : { ...it, bullets: lines.map((line, k) => ({ text: line, factIds: it.bullets[k]?.factIds ?? it.bullets.at(-1)?.factIds ?? [] })) })),
            },
      ),
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[12.5px] text-ink-3">
        {t('docs.summary')}
        <Textarea rows={3} value={c.summary ?? ''} onChange={(e) => setC({ ...c, summary: e.target.value })} />
      </label>
      {c.sections.map((s, si) =>
        s.items.map((it, ii) =>
          s.kind === 'education' && it.bullets.length === 0 ? null : (
            <label key={`${si}-${ii}`} className="flex flex-col gap-1 text-[12.5px] text-ink-3">
              {s.title} · {it.heading}
              {it.subheading ? ` · ${it.subheading}` : ''}
              <Textarea rows={Math.max(2, it.bullets.length + 1)} value={it.bullets.map((b) => b.text).join('\n')} onChange={(e) => setBullets(si, ii, e.target.value)} />
            </label>
          ),
        ),
      )}
      <p className="m-0 text-[12px] text-ink-3">{t('docs.cvEditHint')}</p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          busy={busy}
          onClick={() => onSave({ ...c, sections: c.sections.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, bullets: it.bullets.filter((b) => b.text.trim()) })) })) })}
        >
          {t('common.save')}
        </Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

export function AnswersView({ answers }: { answers: FormAnswer[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {answers.map((a, i) => (
        <li key={i} className="flex flex-col gap-1 rounded-[10px] border border-line bg-ground p-3 text-sm">
          <span className="font-medium">{a.question}</span>
          {a.gap ? <Badge kind="warn">{t('docs.gap')}</Badge> : <span className="whitespace-pre-wrap text-ink-2">{a.answer}</span>}
          {!a.gap ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => {
                void navigator.clipboard?.writeText(a.answer);
                setCopied(i);
              }}
            >
              {copied === i ? t('claude.copied') : t('claude.copy')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AnswersEditor({ answers, onSave, onCancel, busy }: { answers: FormAnswer[]; onSave: (a: FormAnswer[]) => void; onCancel: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const [a, setA] = useState(answers);
  return (
    <div className="flex flex-col gap-2.5">
      {a.map((x, i) => (
        <label key={i} className="flex flex-col gap-1 text-[12.5px] text-ink-2">
          {x.question}
          <Textarea rows={3} value={x.answer} onChange={(e) => setA(a.map((y, j) => (j === i ? { ...y, answer: e.target.value, gap: e.target.value.trim() === '' } : y)))} />
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="primary" busy={busy} onClick={() => onSave(a)}>
          {t('common.save')}
        </Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
