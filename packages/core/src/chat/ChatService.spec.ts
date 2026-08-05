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

  it('stores plain string content unchanged (backward compat)', async () => {
    const appended: string[] = [];
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => [], appendMessage: async (_s, _r, c) => { appended.push(c); }, loadAgent: async () => ({ id: 'a1', systemPrompt: '', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    await svc.appendMessage('s1', 'user', 'hello');
    expect(appended[0]).toBe('hello');
  });

  it('serializes content arrays to a marked string and deserializes them back', async () => {
    const stored: string[] = [];
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => [], appendMessage: async (_s, _r, c) => { stored.push(c); }, loadAgent: async () => ({ id: 'a1', systemPrompt: '', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    const content = [{ type: 'text' as const, text: 'hi' }, { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAA' } }];
    await svc.appendMessage('s1', 'user', content);
    // The TEXT column holds the serialized form.
    expect(stored[0]).not.toBe(content);
    expect(typeof stored[0]).toBe('string');
    // buildModelMessages restores the array for the model layer.
    const history = [{ role: 'user', content: stored[0] }];
    const built = svc.buildModelMessages(history, 'sys');
    expect(built[1].content).toEqual(content);
  });

  it('never mis-parses a plain-string user message that looks like JSON', () => {
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => [], appendMessage: async () => {}, loadAgent: async () => ({ id: 'a1', systemPrompt: '', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    const looksLikeJson = '[{"type":"text","text":"hi"}]';
    const built = svc.buildModelMessages([{ role: 'user', content: looksLikeJson }], 'sys');
    expect(built[1].content).toBe(looksLikeJson);
  });
});
