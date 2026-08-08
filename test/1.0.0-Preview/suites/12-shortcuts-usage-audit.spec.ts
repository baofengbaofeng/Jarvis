import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron, rendererHref } from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';


test.describe.configure({ mode: 'serial' });

let dataDir: string;
let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const mock = await startMockOpenAIProvider();
  dataDir = createIsolatedDataDir();
  ({ app, window } = await launchJarvisElectron(dataDir));
  await completeOnboarding(window);

  await window.goto(rendererHref('/settings/providers'));
  await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });
  await window.getByTestId('provider-name').fill('Audit-Seed-Provider');
  await window.getByTestId('provider-type-openai-compatible').check();
  await window.getByTestId('provider-baseurl').fill(mock.baseUrl);
  await window.getByTestId('provider-apikey').fill('sk-audit-seed');
  await window.getByTestId('provider-save').click();
  await expect(window.getByText('Audit-Seed-Provider')).toBeVisible({ timeout: 15_000 });
  await mock.close();
});

test.afterAll(async () => {
  if (app) await closeJarvisElectron(app);
  if (dataDir) removeDataDir(dataDir);
});

test('12-shortcuts P0: shortcuts settings view', async () => {
  await window.goto(rendererHref('/settings/shortcuts'));
  await expect(window.getByTestId('shortcuts-view')).toBeVisible({ timeout: 30_000 });
  await expect(window.getByTestId('shortcuts-save')).toBeVisible();
});

test('12-usage P0: usage dashboard loads after loading state', async () => {
  await window.goto(rendererHref('/settings/usage'));
  await window.getByTestId('usage-loading').waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
  await expect(window.getByTestId('usage-dashboard')).toBeVisible({ timeout: 30_000 });
  await expect(window.getByTestId('usage-total-tokens')).toBeVisible();
});

test('12-audit P0: audit log view renders', async () => {
  await window.goto(rendererHref('/settings/audit'));
  await expect(window.getByTestId('audit-log')).toBeVisible({ timeout: 30_000 });
  await expect(window.getByTestId('audit-kind')).toBeVisible();

  const entries = await window.evaluate(async () => {
    return (await window.jarvis.invoke('audit.list', {})) as Array<{ action: string }>;
  });
  expect(Array.isArray(entries)).toBe(true);
});
