import { describe, it, expect } from 'vitest';
import { createChatService } from './ChatService';
import type { ChatMessage } from '@jarvis/protocol';

describe('ChatService', () => {
  it('builds model messages with system prefix and history', () => {
    // Full ChatMessage shape so the mock loadMessages return satisfies
    // ChatMessage[] under strict typecheck.
    const msgs: ChatMessage[] = [
      { id: 'm1', sessionId: 's1', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'm2', sessionId: 's1', role: 'assistant', content: 'hello', createdAt: '2024-01-01T00:00:01.000Z' }
    ];
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => msgs, appendMessage: async () => {}, loadAgent: async () => ({ id: 'a1', systemPrompt: 'You are helpful', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    const result = svc.buildModelMessages(msgs, 'You are helpful');
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(result.length).toBe(3);
  });
});
