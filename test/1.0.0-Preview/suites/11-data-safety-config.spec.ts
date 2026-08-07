import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

function assertNoPlaintextApiKey(value: unknown, path = 'root'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoPlaintextApiKey(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(key, `plaintext apiKey at ${path}.${key}`).not.toBe('apiKey');
    assertNoPlaintextApiKey(child, `${path}.${key}`);
  }
}

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const mock = await startMockOpenAIProvider();
  dataDir = createIsolatedDataDir();
  ({ app, window } = await launchJarvisElectron(dataDir));
  await completeOnboarding(window);

  await window.goto(`${RENDERER_URL}/settings/providers`);
  await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });
  await window.getByTestId('provider-add-open').click();
  await window.getByTestId('provider-name').fill('Safety Export Provider');
  await window.getByTestId('provider-type').selectOption('openai-compatible');
  await window.getByTestId('provider-baseurl').fill(mock.baseUrl);
  await window.getByTestId('provider-apikey').fill('sk-safety-export-test');
  await window.getByTestId('provider-save').click();
  await expect(window.getByText('Safety Export Provider')).toBeVisible({ timeout: 15_000 });
  await mock.close();
});

test.afterAll(async () => {
  if (app) await closeJarvisElectron(app);
  if (dataDir) removeDataDir(dataDir);
});

test('11-data-safety P0: backup and wipe tabs visible', async () => {
  await window.goto(`${RENDERER_URL}/settings/data-safety`);
  await window.getByTestId('data-safety-page').waitFor({ timeout: 30_000 });
  await expect(window.getByTestId('safety-tab-backup')).toBeVisible();
  await expect(window.getByTestId('safety-tab-wipe')).toBeVisible();
  await expect(window.getByTestId('backup-pane')).toBeVisible();
});

test('11-data-safety P0: backup-now creates entry in isolated dataDir', async () => {
  await window.goto(`${RENDERER_URL}/settings/data-safety`);
  await window.getByTestId('backup-pane').waitFor({ timeout: 30_000 });
  await window.getByTestId('backup-now').click();

  const itemVisible = await window.getByTestId('backup-item').first()
    .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);

  if (!itemVisible) {
    const backups = await window.evaluate(async () => {
      return (await window.jarvis.invoke('backup.list')) as Array<{ file: string }>;
    });
    expect(backups.length).toBeGreaterThan(0);
  } else {
    await expect(window.getByTestId('backup-item').first()).toBeVisible();
  }
});

test('11-data-safety P0: config export has no plaintext apiKey; merge import smoke', async () => {
  const exported = await window.evaluate(async () => {
    return (await window.jarvis.invoke('config.export', 'json')) as string;
  });
  const parsed = JSON.parse(exported) as Record<string, unknown>;
  assertNoPlaintextApiKey(parsed);
  expect(parsed.schemaVersion).toBeTruthy();
  const providers = parsed.providers as Array<{ apiKeyRef?: string }> | undefined;
  if (providers?.length) {
    expect(providers.some((p) => typeof p.apiKeyRef === 'string' && p.apiKeyRef.length > 0)).toBe(true);
  }

  await window.goto(`${RENDERER_URL}/settings/config`);
  await window.getByTestId('config-transfer').waitFor({ timeout: 30_000 });

  const mergePayload = JSON.stringify({
    schemaVersion: 12,
    exportedAt: new Date().toISOString(),
    providers: [],
    models: [],
    agents: [],
    settings: { concurrency: { perAgent: 3, machine: 8 } },
  });
  const importResult = await window.evaluate(async (payload) => {
    return (await window.jarvis.invoke('config.import', payload, 'merge')) as {
      ok: boolean; created?: number; updated?: number; skipped?: number;
    };
  }, mergePayload);
  expect(importResult.ok).toBe(true);

  const stored = await window.evaluate(async () => {
    return (await window.jarvis.settingsGet('concurrency')) as { perAgent?: number; machine?: number };
  });
  expect(stored.perAgent).toBe(3);
  expect(stored.machine).toBe(8);
});

test('11-data-safety P0: wipe via UI confirmation in isolated dataDir', async () => {
  await window.goto(`${RENDERER_URL}/settings/data-safety`);
  await window.getByTestId('safety-tab-wipe').click();
  await window.getByTestId('wipe-pane').waitFor({ timeout: 30_000 });

  await window.getByTestId('wipe-keychain').uncheck();
  await window.getByTestId('wipe-phrase').fill('DELETE');
  await window.getByTestId('wipe-run').click();

  await expect(window.getByTestId('wipe-msg')).toBeVisible({ timeout: 30_000 });
  const msg = await window.getByTestId('wipe-msg').innerText();
  expect(msg).toContain('vacuumed');
});
