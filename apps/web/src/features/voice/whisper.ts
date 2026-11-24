import type { WorkerMessage, WorkerRequest } from './whisper.worker';

/** Whisper language names for the UI languages (Whisper also auto-detects when null). */
const WHISPER_LANGUAGE: Record<string, string> = { en: 'english', de: 'german', pt: 'portuguese', es: 'spanish', fr: 'french', it: 'italian' };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(fraction: number | null) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') progressListeners.forEach((l) => l(m.total ? m.loaded / m.total : null));
      else if (m.type === 'ready') progressListeners.forEach((l) => l(1));
      else {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.type === 'result') p?.resolve(m.text);
        else p?.reject(new Error(m.message));
      }
    };
  }
  return worker;
}

/** Subscribe to model download progress (0–1, or null when the size is unknown). */
export function onModelProgress(listener: (fraction: number | null) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Decodes recorded audio (webm/ogg/mp4/wav) to 16 kHz mono samples, the format Whisper expects. */
export async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    // Copy: AudioBuffer memory can't be transferred to the worker.
    if (buf.numberOfChannels === 1) return new Float32Array(buf.getChannelData(0));
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i]! += ch[i]! / buf.numberOfChannels;
    }
    return out;
  } finally {
    void ctx.close();
  }
}

/** Transcribes audio on this device with local Whisper. The first call downloads the model (~80 MB). */
export async function transcribeLocally(blob: Blob, uiLanguage: string): Promise<string> {
  const audio = await decodeTo16kMono(blob);
  const id = nextId++;
  const w = getWorker();
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: WorkerRequest = { id, audio, language: WHISPER_LANGUAGE[uiLanguage] ?? null };
    w.postMessage(req, [audio.buffer]);
  });
}
