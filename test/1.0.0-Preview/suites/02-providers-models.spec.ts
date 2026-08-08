import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron, rendererHref } from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';


test('02-providers: anthropic-compatible type persists and shows label', async () => {
  const mock = await startMockOpenAIProvider();
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  const providerName = 'Anthropic-Compat-Provider';

  try {
    await completeOnboarding(window);
    await window.goto(rendererHref('/settings/providers'));
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });

    await expect(window.getByTestId('provider-add-area')).toBeVisible();
    await expect(window.getByTestId('provider-type')).toBeVisible();
    await window.getByTestId('provider-name').fill(providerName);
    await window.getByTestId('provider-type-anthropic-compatible').check();
    await window.getByTestId('provider-baseurl').fill(`${mock.baseUrl}/anthropic`);
    await window.getByTestId('provider-apikey').fill('sk-test');
    await window.getByTestId('provider-save').click();

    await expect(window.getByText(providerName)).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('[data-testid^="provider-type-label-"]')).toHaveText('Anthropic');

    const savedType = await window.evaluate(async (name) => {
      const providers = (await window.jarvis.invoke('provider.list')) as Array<{ name: string; type: string }>;
      return providers.find((p) => p.name === name)?.type;
    }, providerName);
    expect(savedType).toBe('anthropic-compatible');
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});

test('02-providers: create provider, add model, delete', async () => {
  const mock = await startMockOpenAIProvider();
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  const providerName = 'Func-Test-Provider';
  const modelId = 'gpt-mock-test';
  const modelName = 'Mock-Model';

  try {
    await completeOnboarding(window);
    await window.goto(rendererHref('/settings/providers'));
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });

    await expect(window.getByTestId('provider-add-area')).toBeVisible();
    await window.getByTestId('provider-name').fill(providerName);
    await window.getByTestId('provider-type-openai-compatible').check();
    await window.getByTestId('provider-baseurl').fill(mock.baseUrl);
    await window.getByTestId('provider-apikey').fill('sk-test');
    await window.getByTestId('provider-save').click();
    await expect(window.getByText(providerName)).toBeVisible({ timeout: 15_000 });

    const providerId = await window.evaluate(async (name) => {
      const providers = (await window.jarvis.invoke('provider.list')) as Array<{ id: string; name: string }>;
      return providers.find((p) => p.name === name)?.id;
    }, providerName);
    expect(providerId).toBeTruthy();

    await expect(window.getByTestId('provider-table')).toBeVisible();
    await window.getByTestId(`provider-edit-${providerId}`).click();
    await expect(window.getByTestId('provider-edit-modal')).toBeVisible();
    await expect(window.getByTestId(`provider-models-${providerId}`)).toBeVisible();
    await expect(window.getByTestId('provider-model-add-row')).toBeVisible();

    await window.getByTestId('provider-model-id').fill(modelId);
    await window.getByTestId('provider-model-name').fill(modelName);
    await window.getByTestId('provider-model-add').click();
    await expect(window.getByText(new RegExp(modelId))).toBeVisible({ timeout: 15_000 });

    const models = await window.evaluate(async (id) => {
      return (await window.jarvis.invoke('provider.listModels', id)) as Array<{ modelId: string }>;
    }, providerId!);
    expect(models.some((m) => m.modelId === modelId)).toBe(true);

    await window.getByTestId('provider-edit-cancel').click();
    await expect(window.getByTestId(`provider-models-cell-${providerId}`)).toContainText(modelName);

    await window.getByTestId(`provider-delete-${providerId}`).click();
    await expect(window.getByTestId('provider-delete-modal')).toBeVisible();
    await window.getByTestId('provider-delete-confirm').click();

    await expect.poll(async () => {
      return window.evaluate(async (id) => {
        const list = (await window.jarvis.invoke('provider.list')) as Array<{ id: string }>;
        return list.some((p) => p.id === id);
      }, providerId!);
    }).toBe(false);

    await window.reload();
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('provider-add-area')).toBeVisible();
    await expect(window.getByText(providerName)).toHaveCount(0);
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});
