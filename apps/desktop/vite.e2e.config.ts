import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Standalone renderer dev server for Playwright E2E.
// Reuses the renderer half of electron.vite.config.ts (@renderer alias + react),
// serving src/renderer/index.html on port 5173 (electron-vite's default port).
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true }
});
