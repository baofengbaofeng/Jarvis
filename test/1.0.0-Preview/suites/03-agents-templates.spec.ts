import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test.describe.configure({ mode: 'serial' });

test('03-agents: create via IPC appears in list and switcher', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  const agentName = 'Func Test Agent';

  try {
    await completeOnboarding(window);

    const agentId = await window.evaluate(async (name) => {
      const a = (await window.jarvis.invoke('agent.create', {
        name,
        systemPrompt: 'functional test',
        modelId: null,
        workspaceId: null,
      })) as { id: string };
      return a.id;
    }, agentName);
    expect(agentId).toBeTruthy();

    await window.goto(`${RENDERER_URL}/agents`);
    await window.getByTestId('agent-list').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('agent-list').locator('li').filter({ hasText: agentName })).toBeVisible();

    await window.goto(`${RENDERER_URL}/`);
    await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
    await window.getByTestId('agent-switcher').waitFor();
    await expect(window.getByTestId('agent-func-test-agent')).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});

test('03-agents: create from template', async () => {
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  const templateAgentName = 'Template Agent';

  try {
    await completeOnboarding(window);

    const templates = await window.evaluate(async () => {
      return (await window.jarvis.invoke('agent-templates.list')) as Array<{ id: string }>;
    });

    if (templates.length === 0) {
      test.skip(true, 'agent-templates.list returned empty — no seed templates in fresh DB');
      return;
    }

    const tplId = templates[0]!.id;
    await window.goto(`${RENDERER_URL}/agents/templates`);
    await window.getByTestId('template-view').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('template-card').first()).toBeVisible();

    await window.getByTestId(`name-${tplId}`).fill(templateAgentName);
    await window.getByTestId(`create-${tplId}`).click();

    await window.getByTestId('agent-list').waitFor({ timeout: 30_000 });
    await expect(window.getByTestId('agent-list').locator('li').filter({ hasText: templateAgentName })).toBeVisible();

    await window.goto(`${RENDERER_URL}/`);
    await window.getByTestId('agent-switcher').waitFor();
    await expect(window.getByTestId('agent-template-agent')).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
  }
});
