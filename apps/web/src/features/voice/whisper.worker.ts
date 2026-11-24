/// <reference lib="webworker" />
/**
 * Local speech-to-text (spec §5.1): Whisper runs in this web worker via transformers.js and
 * WebAssembly. Audio never leaves the device; only the model is downloaded once from Hugging Face
 * and then kept in the browser cache.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
// Bundled with the app (same version transformers.js uses), so no code is fetched from a CDN.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export const WHISPER_MODEL = 'onnx-community/whisper-base';

export type WorkerRequest = { id: number; audio: Float32Array; language: string | null };
export type WorkerMessage =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string };

const post = (m: WorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href, wasm: new URL(ortWasm, self.location.href).href };
}
env.allowLocalModels = false;

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!loading) {
    const files = new Map<string, { loaded: number; total: number }>();
    loading = pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'progress', loaded, total });
      },
    }).then((p) => {
      post({ type: 'ready' });
      return p as AutomaticSpeechRecognitionPipeline;
    });
    loading.catch(() => (loading = null));
  }
  return loading;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, audio, language } = e.data;
  try {
    const asr = await load();
    const out = await asr(audio, { ...(language ? { language } : {}), task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
    post({ type: 'result', id, text });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
