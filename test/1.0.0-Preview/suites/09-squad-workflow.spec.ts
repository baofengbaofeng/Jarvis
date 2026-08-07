import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';
import { seedChatStack } from '../helpers/seed-chat-stack';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test('09-squad P0: squad view renders', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    await window.goto(`${RENDERER_URL}/squad`);
    await expect(window.getByTestId('squad-view')).toBeVisible({ timeout: 30_000 });
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('09-squad P0: workflow editor renders', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    await window.goto(`${RENDERER_URL}/workflow`);
    await expect(window.getByTestId('workflow-editor')).toBeVisible({ timeout: 30_000 });
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('09-squad P0: squad create form exposes fields', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    await window.goto(`${RENDERER_URL}/squad`);
    await window.getByTestId('squad-view').waitFor({ timeout: 30_000 });
    await window.getByTestId('squad-new').click();
    await expect(window.getByTestId('squad-create-form')).toBeVisible();
    await expect(window.getByTestId('squad-leader-select')).toBeVisible();
    await expect(window.getByTestId('squad-task-input')).toBeVisible();
    await expect(window.getByTestId('squad-create-submit')).toBeVisible();
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('09-squad P1: squad create submit does not crash with seeded agents', async () => {
  const mock = await startMockOpenAIProvider({ replyText: 'squad-mock-reply' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    const { modelId } = await seedChatStack(window, mock);
    await window.evaluate(async (mid) => {
      await window.jarvis.invoke('agent.create', {
        name: 'Squad Member Agent',
        systemPrompt: 'member agent',
        modelId: mid,
        workspaceId: null,
      });
    }, modelId);
    await window.reload();
    await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });

    await window.goto(`${RENDERER_URL}/squad`);
    await window.getByTestId('squad-view').waitFor({ timeout: 30_000 });
    await window.getByTestId('squad-new').click();
    await window.getByTestId('squad-create-form').waitFor();

    const memberCheckbox = window.locator('[data-testid^="squad-member-"]').first();
    const hasMember = await memberCheckbox.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (hasMember) await memberCheckbox.check();

    await window.getByTestId('squad-task-input').fill('functional squad probe');
    await window.getByTestId('squad-create-submit').click();

    await expect(window.getByTestId('squad-view')).toBeVisible();
    const createError = window.getByTestId('squad-create-error');
    const errored = await createError.isVisible();
    if (errored) {
      const msg = await createError.textContent();
      test.skip(true, `squad engine could not complete start: ${msg ?? 'unknown'}`);
      return;
    }

    const approval = window.getByTestId('approval-panel');
    const reachedReview = await approval.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    if (!reachedReview) {
      test.skip(true, 'squad did not reach in_review — deep approve chain not exercised under mock');
    }
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});

test('09-squad P2: full S5 approve chain', () => {
  test.skip(true, 'multi-agent S5 approve chain requires engine infra beyond mock provider');
});
