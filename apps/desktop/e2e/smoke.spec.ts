import { test, expect } from '@playwright/test';

// Use the full Chromium build (headless=new) rather than the separate
// chrome-headless-shell download; `playwright install chromium` provides both.
test.use({ channel: 'chromium' });

// Test-only stand-in for the preload bridge. In a real Electron shell the
// window.jarvis bridge (invoke/settingsGet/settingsSet/onDidReceive) is
// exposed by src/preload/index.ts and persisted through IPC -> SQLite. The
// renderer is launched via a plain vite dev server here (per the M0 milestone
// standard: "dev server + 渲染层行为为准"), so we inject an in-memory mock of
// that bridge before any page script runs (addInitScript executes before the
// renderer module graph is evaluated).
const MOCK_BRIDGE = `
  (() => {
    if (window.__jarvisMockInstalled) return;
    const store = (window.__jarvisStore__ = window.__jarvisStore__ || {});
    window.jarvis = {
      invoke: async () => undefined,
      settingsGet: async (key) => (key in store ? store[key] : undefined),
      settingsSet: async (key, value) => { store[key] = value; },
      onDidReceive: () => () => {}
    };
    window.__jarvisMockInstalled = true;
  })();
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(MOCK_BRIDGE);
});

test('app boots and shows chat page when onboarding done', async ({ page }) => {
  // Deterministic regardless of persisted onboarding state: enter the
  // onboarding route directly (the "/" route redirects to "/onboarding" when
  // onboarding_done is falsy), walk the 3-step wizard, then finish.
  await page.goto('/#/onboarding');
  await page.waitForSelector('[data-testid="onboarding"]', { timeout: 15_000 });
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  // Finish sets onboarding_done (via the bridge mock) and navigates to "/".
  await page.waitForSelector('[data-testid="chat-page"]', { timeout: 15_000 });
  await expect(page.locator('h1, span').first()).toContainText('J.A.R.V.I.S');
});

test('settings page opens and language toggles', async ({ page }) => {
  await page.goto('/#/settings/providers');
  await page.waitForSelector('[data-testid="provider-settings"]', { timeout: 15_000 });
  await page.getByTestId('language-switcher').selectOption('en');
  await expect(page.locator('[data-testid="provider-settings"] .jui-page-header__title')).toHaveText('Add Provider');
});
