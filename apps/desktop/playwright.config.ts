import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true
  },
  webServer: {
    // Renderer dev server (mirrors electron-vite's renderer config) so the
    // BrowserRouter app has an http origin to navigate routes against.
    command: 'pnpm exec vite --config vite.e2e.config.ts',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
