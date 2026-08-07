import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let app: ElectronApplication;
let window: Page;
let agentId: string;

test.beforeAll(async () => {
  dataDir = createIsolatedDataDir();
  ({ app, window } = await launchJarvisElectron(dataDir));
  await completeOnboarding(window);
  agentId = await window.evaluate(async () => {
    const agent = (await window.jarvis.invoke('agent.create', {
      name: 'Settings Func Agent',
      systemPrompt: 'settings test',
      modelId: null,
      workspaceId: null,
    })) as { id: string };
    return agent.id;
  });
});

test.afterAll(async () => {
  if (app) await closeJarvisElectron(app);
  if (dataDir) removeDataDir(dataDir);
});

test('06-settings P0: MCP add server row', async () => {
  const mcpName = 'Func MCP Echo';
  await window.goto(`${RENDERER_URL}/settings/mcp`);
  await window.getByTestId('mcp-settings').waitFor({ timeout: 30_000 });

  await window.getByTestId('mcp-name').fill(mcpName);
  await window.getByTestId('mcp-command').fill('echo');
  await window.getByTestId('mcp-add').click();

  await expect(window.locator('[data-testid^="mcp-server-"]').filter({ hasText: mcpName })).toBeVisible({ timeout: 15_000 });
});

test('06-settings P0: skills settings visible', async () => {
  await window.goto(`${RENDERER_URL}/settings/skills`);
  await expect(window.getByTestId('skills-settings')).toBeVisible({ timeout: 30_000 });
  await expect(window.getByTestId('skills-import')).toBeVisible();
});

test('06-settings P0: permissions save persists', async () => {
  await window.goto(`${RENDERER_URL}/settings/permissions`);
  await window.getByTestId('permissions-settings').waitFor({ timeout: 30_000 });

  await window.getByTestId('perm-agent').selectOption(agentId);
  await window.getByTestId('perm-level').selectOption('readonly');
  await window.getByTestId('perm-save').click();

  const saved = await window.evaluate(async (id) => {
    return (await window.jarvis.settingsGet(`permissions.${id}`)) as { level?: string };
  }, agentId);
  expect(saved.level).toBe('readonly');

  await window.reload();
  await window.getByTestId('permissions-settings').waitFor({ timeout: 30_000 });
  await window.getByTestId('perm-agent').selectOption(agentId);
  await expect(window.getByTestId('perm-level')).toHaveValue('readonly');
});

test('06-settings P0: env vars save persists', async () => {
  await window.goto(`${RENDERER_URL}/settings/env`);
  await window.getByTestId('env-settings').waitFor({ timeout: 30_000 });

  await window.getByTestId('env-agent').selectOption(agentId);
  await window.getByTestId('env-text').fill('FUNC_TEST_KEY=func-value');
  await window.getByTestId('env-save').click();

  const envVars = await window.evaluate(async (id) => {
    const agents = (await window.jarvis.invoke('agent.list')) as Array<{ id: string; envVars?: Record<string, string> }>;
    return agents.find((a) => a.id === id)?.envVars ?? {};
  }, agentId);
  expect(envVars.FUNC_TEST_KEY).toBe('func-value');
});

test('06-settings P0: concurrency save persists after restart', async () => {
  await window.goto(`${RENDERER_URL}/settings/concurrency`);
  await window.getByTestId('concurrency-settings').waitFor({ timeout: 30_000 });

  await window.getByTestId('concurrency-peragent').fill('4');
  await window.getByTestId('concurrency-machine').fill('12');
  await window.getByTestId('concurrency-save').click();

  await window.getByTestId('concurrency-settings').waitFor({ timeout: 60_000 });
  await expect(window.getByTestId('concurrency-peragent')).toHaveValue('4');
  await expect(window.getByTestId('concurrency-machine')).toHaveValue('12');

  const stored = await window.evaluate(async () => {
    return (await window.jarvis.settingsGet('concurrency')) as { perAgent?: number; machine?: number };
  });
  expect(stored.perAgent).toBe(4);
  expect(stored.machine).toBe(12);
});

test('06-settings P1: MCP test may skip if process fails', async () => {
  await window.goto(`${RENDERER_URL}/settings/mcp`);
  await window.getByTestId('mcp-settings').waitFor({ timeout: 30_000 });

  const serverRow = window.locator('[data-testid^="mcp-server-"]').first();
  expect(await serverRow.count()).toBeGreaterThan(0);

  const testId = await serverRow.getAttribute('data-testid');
  const serverId = testId?.replace('mcp-server-', '');
  expect(serverId).toBeTruthy();

  await window.getByTestId(`mcp-test-${serverId}`).click();
  const result = window.getByTestId(`mcp-test-result-${serverId}`);
  const appeared = await result.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
  expect(appeared).toBeTruthy();
});
