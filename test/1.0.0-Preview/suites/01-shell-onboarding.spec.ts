import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron, rendererHref } from '../helpers/electron-app';


test.describe.configure({ mode: 'serial' });

test('01-shell: onboarding completes and shows nav', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(window);
    await expect(window.getByTestId('chat-page')).toBeVisible();
    await expect(window.getByTestId('nav-chat')).toBeVisible();
    await expect(window.getByTestId('nav-settings')).toBeVisible();
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('01-shell: onboarding persists on relaunch', async () => {
  const dataDir = createIsolatedDataDir();
  const first = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(first.window);
  } finally {
    await closeJarvisElectron(first.app);
  }

  const second = await launchJarvisElectron(dataDir);
  try {
    await second.window.goto(rendererHref('/'));
    await second.window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
    await expect(second.window.getByTestId('onboarding')).toHaveCount(0);
  } finally {
    await closeJarvisElectron(second.app);
    removeDataDir(dataDir);
  }
});

test('01-shell: language switcher on providers settings', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(window);
    await window.goto(rendererHref('/settings/providers'));
    await window.getByTestId('provider-settings').waitFor({ timeout: 30_000 });
    await window.getByTestId('settings-layout').getByTestId('language-switcher').selectOption('en');
    await expect(window.locator('[data-testid="provider-settings"] h2')).toHaveText('Provider Management');
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});
