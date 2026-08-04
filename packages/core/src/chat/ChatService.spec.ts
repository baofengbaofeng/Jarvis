import { describe, it, expect } from 'vitest';
import { createChatService } from './ChatService';

describe('ChatService', () => {
  it('builds model messages with system prefix and history', () => {
    // role typed as the ChatRole union so the mock loadMessages return satisfies
    // Array<Omit<ChatMessage, 'id'|'sessionId'|'createdAt'>> under strict typecheck.
    const msgs: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ];
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => msgs, appendMessage: async () => {}, loadAgent: async () => ({ id: 'a1', systemPrompt: 'You are helpful', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    const result = svc.buildModelMessages(msgs, 'You are helpful');
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(result.length).toBe(3);
  });
});
