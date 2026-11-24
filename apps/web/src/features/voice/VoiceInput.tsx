import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../lib/settings';
import { Button, ErrorText } from '../../components/ui';
import { onModelProgress, transcribeLocally } from './whisper';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function browserRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LOCALES: Record<string, string> = { en: 'en-US', de: 'de-DE', pt: 'pt-PT', es: 'es-ES', fr: 'fr-FR' };

/** Optional text-to-speech for interview questions (browser speech synthesis). */
export function speak(text: string, lang: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LOCALES[lang] ?? lang;
  window.speechSynthesis.speak(u);
}

/**
 * Microphone button (spec §5.1 step 4). Local Whisper keeps audio on this machine (it is sent only
 * to the local Jobhunter engine); the browser option uses the Web Speech API, which may send audio to
 * the browser vendor. The transcript is put into the answer box for editing before sending.
 */
export function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const mode = settings.data?.voice ?? 'off';
  const lang = settings.data?.language ?? 'en';
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => onModelProgress((f) => setDownload(f === null || f >= 1 ? null : f)), []);

  useEffect(
    () => () => {
      recRef.current?.stream.getTracks().forEach((tr) => tr.stop());
      speechRef.current?.stop();
    },
    [],
  );

  if (mode === 'off') return null;
  const Recognition = mode === 'browser' ? browserRecognition() : null;
  if (mode === 'browser' && !Recognition) return <p className="m-0 text-[12.5px] text-ink-3">{t('voice.browserUnsupported')}</p>;

  const startLocal = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setBusy(true);
        try {
          const text = await transcribeLocally(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }), lang);
          if (text) onTranscript(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setError(t('voice.micDenied'));
    }
  };

  const startBrowser = () => {
    setError(null);
    const r = new Recognition!();
    r.lang = LOCALES[lang] ?? lang;
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) parts.push(res[0]!.transcript);
      }
      if (parts.length) onTranscript(parts.join(' '));
    };
    r.onerror = (e) => setError(e.error);
    r.onend = () => setRecording(false);
    r.start();
    speechRef.current = r;
    setRecording(true);
  };

  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    speechRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" aria-pressed={recording} busy={busy} onClick={() => (recording ? stop() : mode === 'browser' ? startBrowser() : void startLocal())}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
        </svg>
        {recording ? t('voice.stop') : busy ? t('voice.transcribing') : t('voice.record')}
      </Button>
      {download !== null ? (
        <span className="text-[12px] text-ink-2" role="status">
          {t('voice.downloading', { percent: Math.round(download * 100) })}
        </span>
      ) : null}
      <span className="text-[12px] text-ink-3">{mode === 'local_whisper' ? t('voice.localNote') : t('voice.browserNote')}</span>
      {error ? <ErrorText error={error} /> : null}
    </div>
  );
}
