import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';
import { startMockOpenAIProvider, fetchMockHealth } from '../helpers/mock-provider';

test('helpers: launch + bridge + mock health', async () => {
  const mock = await startMockOpenAIProvider({ replyText: 'pong' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    const hasBridge = await window.evaluate(() => typeof window.jarvis?.invoke === 'function');
    expect(hasBridge).toBe(true);
    expect(await fetchMockHealth(mock)).toBe(true);
    await completeOnboarding(window);
    await expect(window.getByTestId('chat-page')).toBeVisible();
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});
