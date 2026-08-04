import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@jarvis/protocol', '@jarvis/i18n', '@jarvis/core'] })] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['@jarvis/protocol', '@jarvis/i18n', '@jarvis/core'] })] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
});
