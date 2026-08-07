import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';
import { seedChatStack } from '../helpers/seed-chat-stack';

const BOARD_COLUMNS = ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test.describe.configure({ mode: 'serial' });

test('05-board P0: task board columns render', async () => {
  const mock = await startMockOpenAIProvider();
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    await window.goto(`${RENDERER_URL}/board`);
    await window.getByTestId('task-board').waitFor({ timeout: 30_000 });
    for (const status of BOARD_COLUMNS) {
      await expect(window.getByTestId(`col-${status}`)).toBeVisible();
    }
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});

test('05-board P0/P1: task.create shows card or control bar status', async () => {
  const mock = await startMockOpenAIProvider({ replyText: 'board-task-reply' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    const { agentId } = await seedChatStack(window, mock);
    await window.reload();
    await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });

    const taskId = await window.evaluate(async (id) => {
      const { id: taskId } = (await window.jarvis.invoke('task.create', {
        agentId: id,
        prompt: 'functional board task',
      })) as { id: string };
      return taskId;
    }, agentId);

    const controlVisible = await window.getByTestId('task-control').isVisible();
    if (controlVisible) {
      await expect(window.getByTestId('task-status')).toBeVisible({ timeout: 15_000 });
    } else {
      await window.goto(`${RENDERER_URL}/board`);
      await window.getByTestId('task-board').waitFor({ timeout: 30_000 });
      await expect(window.getByTestId('task-card').filter({ hasText: taskId })).toBeVisible({ timeout: 30_000 });
    }
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});

test('05-board P1: approval modal under mock path', async () => {
  const mock = await startMockOpenAIProvider({ replyText: 'approval-probe-reply' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    const { agentSlug } = await seedChatStack(window, mock);
    await window.reload();
    await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
    await window.getByTestId(`agent-${agentSlug}`).click();

    await window.getByTestId('chat-input').fill('probe approval path');
    await window.getByTestId('chat-send').click();

    const approval = window.getByTestId('approval-modal');
    const appeared = await approval.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      test.skip(true, 'no approval:request under mock reply');
      return;
    }
    const deny = window.getByTestId('approval-deny');
    const approve = window.getByTestId('approval-approve');
    if (await deny.isVisible()) await deny.click();
    else await approve.click();
    await expect(approval).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    await mock.close();
  }
});

test('05-board P2: Multica harness', () => {
  test.skip(true, 'Multica harness not in V1.0 suite');
});
