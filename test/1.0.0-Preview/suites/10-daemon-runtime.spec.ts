import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test.describe.configure({ mode: 'serial' });

test('10-daemon P0: status page shows management and running state', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(window);
    await window.goto(`${RENDERER_URL}/settings/daemon`);
    await window.getByTestId('daemon-management').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('daemon-running')).toBeVisible();
    const text = await window.getByTestId('daemon-running').innerText();
    expect(text.length).toBeGreaterThan(0);

    await window.getByTestId('daemon-restart').click();
    await expect(window.getByTestId('daemon-running')).toBeVisible({ timeout: 15_000 });
    const afterRestart = await window.getByTestId('daemon-running').innerText();
    expect(afterRestart.length).toBeGreaterThan(0);
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('10-daemon P2: injection approvals require Multica harness', async () => {
  test.skip(!process.env.JARVIS_FUNC_DEEP, 'injection approvals / Multica require JARVIS_FUNC_DEEP');
  throw new Error('Multica injection-approval harness not wired in functional suite');
});
