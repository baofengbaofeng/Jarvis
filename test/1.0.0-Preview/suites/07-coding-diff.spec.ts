import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir, closeJarvisElectron,
} from '../helpers/electron-app';
import { makeTempWorkspace, removeTempWorkspace } from '../helpers/fixtures';
import { startMockOpenAIProvider } from '../helpers/mock-provider';
import { seedChatStack } from '../helpers/seed-chat-stack';

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

test.describe.configure({ mode: 'serial' });

test('07-coding P0: coding panel shows file tree for bound workspace', async () => {
  const workspaceDir = makeTempWorkspace({ 'src/a.ts': ' const x = 1\n' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    const agentId = await window.evaluate(async () => {
      const agent = (await window.jarvis.invoke('agent.create', {
        name: 'Coding Func Agent',
        systemPrompt: 'coding test',
        modelId: null,
        workspaceId: null,
      })) as { id: string };
      return agent.id;
    });

    await window.evaluate(async ({ id, path }) => {
      await window.jarvis.invoke('agent.update', id, { workspaceId: path });
    }, { id: agentId, path: workspaceDir });

    await window.goto(`${RENDERER_URL}/coding`);
    const panel = window.getByTestId('coding-panel');
    await panel.waitFor({ timeout: 30_000 });
    await expect(panel.getByTestId('file-tree').first()).toBeVisible();
    await expect(panel.getByTestId('tree-dir').filter({ hasText: 'src/' })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId('tree-file').filter({ hasText: 'a.ts' })).toBeVisible();
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    removeTempWorkspace(workspaceDir);
  }
});

test('07-coding P1: diff hunk accept when task snapshot seeded', async () => {
  const workspaceDir = makeTempWorkspace({ 'src/a.ts': ' const x = 1\n' });
  const mock = await startMockOpenAIProvider({ replyText: 'coding-diff-reply' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);

  try {
    await completeOnboarding(window);
    const { agentId } = await seedChatStack(window, mock);

    await window.evaluate(async ({ id, path }) => {
      await window.jarvis.invoke('agent.update', id, { workspaceId: path });
    }, { id: agentId, path: workspaceDir });

    const taskId = await window.evaluate(async (id) => {
      const { id: created } = (await window.jarvis.invoke('task.create', {
        agentId: id,
        prompt: 'diff functional probe',
      })) as { id: string };
      await window.jarvis.invoke('task.cancel', created);
      return created;
    }, agentId);

    writeFileSync(join(workspaceDir, 'src/a.ts'), ' const x = 2\n', 'utf8');

    const diffProbe = await window.evaluate(async ({ id, rel }) => {
      return (await window.jarvis.invoke('diff.read', { taskId: id, path: rel })) as {
        ok: boolean; changed?: boolean; error?: string;
      };
    }, { id: taskId, rel: 'src/a.ts' });

    expect(
      diffProbe.ok && diffProbe.changed,
      `diff.read did not report changes (ok=${diffProbe.ok} changed=${diffProbe.changed} err=${diffProbe.error ?? ''})`,
    ).toBeTruthy();

    await window.goto(`${RENDERER_URL}/coding`);
    const panel = window.getByTestId('coding-panel');
    await panel.waitFor({ timeout: 30_000 });

    const storeSet = await window.evaluate(async (id) => {
      const candidates = [
        '/src/stores/task-store.ts',
        '@renderer/stores/task-store',
      ];
      for (const spec of candidates) {
        try {
          const mod = await import(/* @vite-ignore */ spec);
          if (mod.useTaskStore) {
            mod.useTaskStore.setState({ activeTaskId: id });
            return mod.useTaskStore.getState().activeTaskId === id;
          }
        } catch { /* try next */ }
      }
      return false;
    }, taskId);

    expect(storeSet).toBeTruthy();

    await panel.getByTestId('tree-file').filter({ hasText: 'a.ts' }).click();

    const accept = window.getByTestId('hunk-0-accept');
    const hasHunk = await accept.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    expect(hasHunk).toBeTruthy();

    await accept.click();
    await window.getByTestId('diff-commit').click();
    await expect.poll(async () => {
      const r = (await window.evaluate(async () => {
        return (await window.jarvis.invoke('workspace.read', 'src/a.ts')) as { ok: boolean; content?: string };
      })) as { ok: boolean; content?: string };
      return r.ok ? r.content ?? '' : '';
    }).toContain('const x = 2');
  } finally {
    await closeJarvisElectron(app);
    removeDataDir(dataDir);
    removeTempWorkspace(workspaceDir);
    await mock.close();
  }
});
