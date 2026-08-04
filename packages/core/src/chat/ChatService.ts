import type { AgentConfig, ChatMessage, ChatSession } from '@jarvis/protocol';
import type { ModelMessage } from '../model/types';

export interface ChatDbAdapter {
  listSessions(): Promise<ChatSession[]>;
  createSession(title?: string): Promise<ChatSession>;
  loadMessages(sessionId: string): Promise<Array<Omit<ChatMessage, 'id' | 'sessionId' | 'createdAt'>>>;
  appendMessage(sessionId: string, role: string, content: string): Promise<void>;
  loadAgent(agentId: string): Promise<AgentConfig>;
}

export function createChatService(db: ChatDbAdapter) {
  return {
    async listSessions() { return db.listSessions(); },
    async createSession(title?: string) { return db.createSession(title); },
    async loadMessages(sessionId: string) { return db.loadMessages(sessionId); },
    async appendMessage(sessionId: string, role: string, content: string) { return db.appendMessage(sessionId, role, content); },
    buildModelMessages(history: Array<{ role: string; content: string }>, systemPrompt: string): ModelMessage[] {
      return [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))
      ];
    }
  };
}
