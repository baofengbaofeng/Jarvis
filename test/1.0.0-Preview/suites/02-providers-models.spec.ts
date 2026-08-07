import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron, rendererHref } from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';


test('02-providers: create provider, add model, delete', async () => {
  const mock = await startMockOpenAIProvider();
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  const providerName = 'Func Test Provider';
  const modelId = 'gpt-mock-test';
  const modelName = 'Mock Model';

  try {
    await completeOnboarding(window);
    await window.goto(rendererHref('/settings/providers'));
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });

    await window.getByTestId('provider-add-open').click();
    await window.getByTestId('provider-name').fill(providerName);
    await window.getByTestId('provider-type').selectOption('openai-compatible');
    await window.getByTestId('provider-baseurl').fill(mock.baseUrl);
    await window.getByTestId('provider-apikey').fill('sk-test');
    await window.getByTestId('provider-save').click();
    await expect(window.getByText(providerName)).toBeVisible({ timeout: 15_000 });

    const providerId = await window.evaluate(async (name) => {
      const providers = (await window.jarvis.invoke('provider.list')) as Array<{ id: string; name: string }>;
      return providers.find((p) => p.name === name)?.id;
    }, providerName);
    expect(providerId).toBeTruthy();

    await expect(window.getByTestId(`provider-models-${providerId}`)).toBeVisible();
    await expect(window.getByText(providerName)).toBeVisible();

    await window.getByTestId('provider-model-id').fill(modelId);
    await window.getByTestId('provider-model-name').fill(modelName);
    await window.getByTestId('provider-model-add').click();
    await expect(window.getByText(new RegExp(modelId))).toBeVisible({ timeout: 15_000 });

    const models = await window.evaluate(async (id) => {
      return (await window.jarvis.invoke('provider.listModels', id)) as Array<{ modelId: string }>;
    }, providerId!);
    expect(models.some((m) => m.modelId === modelId)).toBe(true);

    await window.locator('li').filter({ hasText: providerName }).getByRole('button').first().click();

    await expect.poll(async () => {
      return window.evaluate(async (id) => {
        const list = (await window.jarvis.invoke('provider.list')) as Array<{ id: string }>;
        return list.some((p) => p.id === id);
      }, providerId!);
    }).toBe(false);

    await window.reload();
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('provider-empty')).toBeVisible();
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});
