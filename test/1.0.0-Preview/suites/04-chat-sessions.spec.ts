import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron } from '../helpers/electron-app';
import { startMockOpenAIProvider, type MockProviderHandle } from '../helpers/mock-provider';
import { seedChatStack } from '../helpers/seed-chat-stack';

const REPLY_TEXT = 'func-chat-reply-04';

test.describe.configure({ mode: 'serial' });

let mock: MockProviderHandle;
let dataDir: string;
let app: ElectronApplication;
let window: Page;
let agentSlug: string;

test.beforeAll(async () => {
  mock = await startMockOpenAIProvider({ replyText: REPLY_TEXT });
  dataDir = createIsolatedDataDir();
  ({ app, window } = await launchJarvisElectron(dataDir));
  await completeOnboarding(window);
  ({ agentSlug } = await seedChatStack(window, mock));
  await window.reload();
  await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
});

test.afterAll(async () => {
  if (app) await closeJarvisElectron(app);
  if (dataDir) removeDataDir(dataDir);
  if (mock) await mock.close();
});

test('04-chat P0: chat-new increases session count', async () => {
  await window.getByTestId('chat-new').click();
  const sessionCount = await window.evaluate(async (listChannel) => {
    const sessions = (await window.jarvis.invoke(listChannel)) as Array<{ id: string }>;
    return sessions.length;
  }, 'chat.listSessions');
  expect(sessionCount).toBeGreaterThanOrEqual(1);
});

test('04-chat P1: send message receives mock reply', async () => {
  await window.getByTestId('agent-switcher').waitFor();
  await window.getByTestId(`agent-${agentSlug}`).click();

  await window.getByTestId('chat-input').fill('hello from functional test');
  await window.getByTestId('chat-send').click();

  const assistant = window.getByTestId('message-assistant').or(window.getByTestId('streaming-text'));
  await expect(assistant.filter({ hasText: REPLY_TEXT })).toBeVisible({ timeout: 60_000 });
});
