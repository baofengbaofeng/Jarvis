import type { AgentConfig, ChatMessage, ChatSession } from '@jarvis/protocol';
import type { ModelMessage } from '../model/types';
import { isContentArray, type MessageContent } from '../office/content';

export interface ChatDbAdapter {
  listSessions(): Promise<ChatSession[]>;
  createSession(title?: string): Promise<ChatSession>;
  loadMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(sessionId: string, role: string, content: string): Promise<void>;
  loadAgent(agentId: string): Promise<AgentConfig>;
}

// Serialization of multimodal content into the chat_messages TEXT column (schema
// v1 — NO migration). Content arrays are stored as `CONTENT_MARKER + JSON`.
//
// Why the marker is unambiguous: the marker is NUL-delimited, so no user-authored
// string can begin with it (NUL is not reachable from a textarea / clipboard /
// JSON IPC). A message that merely *looks* like a content array — e.g. the user
// types `[{"type":"text","text":"hi"}]` — is stored as that literal text (no
// marker) and deserializes to the same plain string. Even a hand-crafted string
// that *does* carry the marker is only accepted after `isContentArray` validates
// every part on parse (validation-on-parse), otherwise it falls back to raw text.
const CONTENT_MARKER = '\u0000jarvis:content\u0000';

function serializeContent(content: string | MessageContent): string {
  return typeof content === 'string' ? content : CONTENT_MARKER + JSON.stringify(content);
}

function deserializeContent(content: string): string | MessageContent {
  if (!content.startsWith(CONTENT_MARKER)) return content;
  try {
    const parsed: unknown = JSON.parse(content.slice(CONTENT_MARKER.length));
    if (isContentArray(parsed)) return parsed;
  } catch {
    /* malformed marker payload — fall through to raw text */
  }
  return content;
}

export function createChatService(db: ChatDbAdapter) {
  return {
    async listSessions() { return db.listSessions(); },
    async createSession(title?: string) { return db.createSession(title); },
    async loadMessages(sessionId: string) { return db.loadMessages(sessionId); },
    async appendMessage(sessionId: string, role: string, content: string | MessageContent) {
      // Arrays are serialized here so the DB adapter only ever sees a string.
      return db.appendMessage(sessionId, role, serializeContent(content));
    },
    buildModelMessages(history: Array<{ role: string; content: string }>, systemPrompt: string): ModelMessage[] {
      return [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role as ModelMessage['role'], content: deserializeContent(h.content) }))
      ];
    }
  };
}
