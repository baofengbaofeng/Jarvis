import { defineConfig } from '@playwright/test';

const rendererServer = {
  command: 'pnpm exec vite --config vite.e2e.config.ts',
  url: 'http://127.0.0.1:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'renderer',
      testMatch: ['smoke.spec.ts', 'ipc-allowlist.spec.ts', 's2-file-shell.spec.ts'],
      use: {
        baseURL: 'http://127.0.0.1:5173',
        headless: true,
        channel: 'chromium',
      },
      webServer: rendererServer,
    },
    {
      name: 'electron',
      testMatch: ['electron-smoke.spec.ts'],
      workers: 1,
      use: {
        headless: true,
      },
      webServer: rendererServer,
    },
  ],
});
