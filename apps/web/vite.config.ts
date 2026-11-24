import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const engine = process.env.JOBHUNTER_ENGINE_URL ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/ws': { target: engine.replace(/^http/u, 'ws'), ws: true },
      '/api': engine,
    },
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
