import { test, expect } from '@playwright/test';
import { IpcChannel } from '@jarvis/protocol';
import {
  launchJarvisElectron,
  completeOnboarding,
  removeDataDir,
  createIsolatedDataDir,
} from './helpers/electron-app';

test.describe.configure({ mode: 'serial' });

test.afterEach(async ({}, testInfo) => {
  const dir = testInfo.annotations.find(a => a.type === 'jarvis-data-dir')?.description;
  if (dir) removeDataDir(dir);
});

test('real shell: preload bridge and IPC allowlist', async ({}, testInfo) => {
  const dataDir = createIsolatedDataDir();
  testInfo.annotations.push({ type: 'jarvis-data-dir', description: dataDir });
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    const hasBridge = await window.evaluate(() => typeof window.jarvis?.invoke === 'function');
    expect(hasBridge).toBe(true);

    const blocked = await window.evaluate(async () => {
      try {
        await window.jarvis.invoke('secrets.get', 'probe');
        return 'allowed';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(blocked).toMatch(/not allowed/i);

    const settingsOk = await window.evaluate(async () => {
      await window.jarvis.settingsSet('e2e_probe', '1');
      return window.jarvis.settingsGet('e2e_probe');
    });
    expect(settingsOk).toBe('1');
  } finally {
    await app.close();
  }
});

test('real shell: onboarding persists through SQLite + IPC', async ({}, testInfo) => {
  const dataDir = createIsolatedDataDir();
  testInfo.annotations.push({ type: 'jarvis-data-dir', description: dataDir });
  const first = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(first.window);
    await expect(first.window.getByTestId('chat-sessions-title')).toBeVisible();
  } finally {
    await first.app.close();
  }

  const second = await launchJarvisElectron(dataDir);
  try {
    await second.window.goto('http://127.0.0.1:5173/#/');
    await second.window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
    await expect(second.window.getByTestId('onboarding')).toHaveCount(0);
  } finally {
    await second.app.close();
  }
});

test('real shell: agent.create and chat session IPC', async ({}, testInfo) => {
  const dataDir = createIsolatedDataDir();
  testInfo.annotations.push({ type: 'jarvis-data-dir', description: dataDir });
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(window);

    const agentId = await window.evaluate(async (createChannel) => {
      const a = (await window.jarvis.invoke(createChannel, {
        name: 'E2E Agent',
        systemPrompt: 'e2e',
        modelId: null,
        workspaceId: null,
      })) as { id: string };
      return a.id;
    }, IpcChannel.agentCreate);
    expect(agentId).toBeTruthy();

    await window.reload();
    await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
    await window.getByTestId('agent-switcher').waitFor();
    await expect(window.getByTestId(`agent-e2e-agent`)).toBeVisible({ timeout: 15_000 });

    await window.getByTestId('chat-new').click();
    const sessionCount = await window.evaluate(async (listChannel) => {
      const sessions = (await window.jarvis.invoke(listChannel)) as Array<{ id: string }>;
      return sessions.length;
    }, IpcChannel.chatListSessions);
    expect(sessionCount).toBeGreaterThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test('real shell: daemon status page uses main IPC', async ({}, testInfo) => {
  const dataDir = createIsolatedDataDir();
  testInfo.annotations.push({ type: 'jarvis-data-dir', description: dataDir });
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    await completeOnboarding(window);
    await window.goto('http://127.0.0.1:5173/#/settings/daemon');
    await window.getByTestId('daemon-management').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('daemon-running')).toBeVisible();
    // Daemon binary may be absent in CI — either running or stopped is acceptable.
    const text = await window.getByTestId('daemon-running').innerText();
    expect(text.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
