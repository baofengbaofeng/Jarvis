import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@jarvis/protocol', '@jarvis/i18n', '@jarvis/core'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'plugin-runner-child': resolve(__dirname, 'src/main/plugins/plugin-runner-child.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@jarvis/protocol', '@jarvis/i18n', '@jarvis/core'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
    // TrustedRendererPolicy only allows 127.0.0.1 / [::1] — not "localhost".
    server: { host: '127.0.0.1' },
  }
});
