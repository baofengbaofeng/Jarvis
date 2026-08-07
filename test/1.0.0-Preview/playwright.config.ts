import { defineConfig } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(ROOT, '../../apps/desktop');

export default defineConfig({
  testDir: './suites',
  timeout: 120_000,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  projects: [
    {
      name: 'electron-functional',
      use: { headless: true },
      webServer: {
        command: 'pnpm exec vite --config vite.e2e.config.ts',
        cwd: DESKTOP,
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    },
  ],
});
