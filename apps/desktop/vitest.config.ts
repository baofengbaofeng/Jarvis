import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // ResizeObserver no-op for react-flow (CallGraphView) in jsdom specs; the
    // guard inside makes it a no-op for Node-env main specs too.
    setupFiles: ['./vitest.setup.ts'],
    // e2e/*.spec.ts are Playwright specs (run via pnpm e2e), not vitest specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  }
});
