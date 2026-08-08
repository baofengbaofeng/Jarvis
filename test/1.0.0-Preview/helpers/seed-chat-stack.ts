import type { Page } from '@playwright/test';
import type { MockProviderHandle } from './mock-provider';

export interface SeededChatStack {
  providerId: string;
  modelId: string;
  agentId: string;
  agentSlug: string;
}

/** Create provider + model + agent bound to the mock via IPC. */
export async function seedChatStack(window: Page, mock: MockProviderHandle): Promise<SeededChatStack> {
  return window.evaluate(async ({ baseUrl }) => {
    const created = (await window.jarvis.invoke('provider.create', {
      name: 'Func-Chat-Provider';
      type: 'openai-compatible',
      baseUrl,
      apiKey: 'sk-test',
    })) as { ok: true; provider: { id: string } } | { ok: false; error: string } | { id: string };
    const providerId = 'ok' in created
      ? (created.ok ? created.provider.id : (() => { throw new Error(created.error); })())
      : created.id;
    const added = (await window.jarvis.invoke('provider.addModel', providerId, {
      modelId: 'gpt-mock-chat',
      name: 'Mock-Chat-Model',
    })) as { ok: true; model: { id: string } } | { ok: false; error: string } | { id: string };
    const modelId = 'ok' in added
      ? (added.ok ? added.model.id : (() => { throw new Error(added.error); })())
      : added.id;
    const agent = (await window.jarvis.invoke('agent.create', {
      name: 'Chat Func Agent',
      systemPrompt: 'reply briefly',
      modelId,
      workspaceId: null,
    })) as { id: string; slug: string };
    return { providerId, modelId, agentId: agent.id, agentSlug: agent.slug };
  }, { baseUrl: mock.baseUrl });
}
