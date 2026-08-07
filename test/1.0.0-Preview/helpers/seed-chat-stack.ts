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
    const provider = (await window.jarvis.invoke('provider.create', {
      name: 'Func Chat Provider',
      type: 'openai-compatible',
      baseUrl,
      apiKey: 'sk-test',
    })) as { id: string };
    const model = (await window.jarvis.invoke('provider.addModel', provider.id, {
      modelId: 'gpt-mock-chat',
      name: 'Mock Chat Model',
    })) as { id: string };
    const agent = (await window.jarvis.invoke('agent.create', {
      name: 'Chat Func Agent',
      systemPrompt: 'reply briefly',
      modelId: model.id,
      workspaceId: null,
    })) as { id: string; slug: string };
    return { providerId: provider.id, modelId: model.id, agentId: agent.id, agentSlug: agent.slug };
  }, { baseUrl: mock.baseUrl });
}
