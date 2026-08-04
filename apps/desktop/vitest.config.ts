import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // e2e/*.spec.ts are Playwright specs (run via pnpm e2e), not vitest specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  }
});
