import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { createChatService } from '@jarvis/core';
import { ModelRouter } from '@jarvis/core';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig, ChatRole } from '@jarvis/protocol';

export function createChatDbAdapter(db: Database.Database): Parameters<typeof createChatService>[0] {
  const now = () => new Date().toISOString();
  return {
    async listSessions() {
      return (db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string, title: r.title as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string
      }));
    },
    async createSession(title?: string) {
      const id = randomUUID();
      db.prepare('INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)').run(id, title ?? '新对话', now(), now());
      return { id, title: title ?? '新对话', createdAt: now(), updatedAt: now() };
    },
    async loadMessages(sessionId: string) {
      return (db.prepare('SELECT id, session_id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<{ id: string; session_id: string; role: ChatRole; content: string; created_at: string }>).map(r => ({
        id: r.id, sessionId: r.session_id, role: r.role, content: r.content, createdAt: r.created_at
      }));
    },
    async appendMessage(sessionId: string, role: string, content: string) {
      db.prepare('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), sessionId, role, content, now());
      db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
    },
    async loadAgent(agentId: string) {
      const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
      if (!r) throw new Error(`agent not found: ${agentId}`);
      return {
        id: r.id, name: r.name, slug: r.slug, description: r.description, systemPrompt: r.system_prompt,
        modelId: r.model_id as string | null, workspaceId: r.workspace_id as string | null,
        contextBudgetTokens: r.context_budget_tokens as number, planOnly: Boolean(r.plan_only),
        createdAt: r.created_at, updatedAt: r.updated_at
      } as AgentConfig;
    }
  };
}

export function registerChatHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, deps: { router?: ModelRouter } = {}) {
  const dbAdapter = createChatDbAdapter(db);
  const chatService = createChatService(dbAdapter);
  const router = deps.router ?? new ModelRouter();

  return {
    async listSessions() { return chatService.listSessions(); },
    async createSession(title?: string) { return chatService.createSession(title); },
    async loadMessages(sessionId: string) { return chatService.loadMessages(sessionId); },

    async send(_event: Electron.IpcMainInvokeEvent, args: { sessionId: string; text: string; agentId: string }) {
      const { sessionId, text, agentId } = args;
      await chatService.appendMessage(sessionId, 'user', text);
      const history = await chatService.loadMessages(sessionId);
      const agent = await dbAdapter.loadAgent(agentId);
      const provider = db.prepare(`
        SELECT p.* FROM providers p JOIN models m ON m.provider_id = p.id WHERE m.id = ?
      `).get(agent.modelId) as Record<string, unknown> | undefined;
      if (!provider) throw new Error('agent has no valid model/provider binding');
      const sendChunk = (chunk: unknown) => { getWindow()?.webContents.send(IpcEvent.chatDelta, { sessionId, chunk }); };

      let full = '';
      try {
        await router.chat({
          provider: {
            id: provider.id as string, name: provider.name as string, type: provider.type as 'openai-compatible' | 'anthropic-compatible',
            baseUrl: provider.base_url as string, apiKeyRef: provider.api_key_ref as string, createdAt: provider.created_at as string, updatedAt: provider.updated_at as string
          },
          modelId: (db.prepare('SELECT model_id FROM models WHERE id = ?').get(agent.modelId) as { model_id: string }).model_id,
          messages: chatService.buildModelMessages(history, agent.systemPrompt),
          stream: true
        }, {
          apiKeyResolver: async (ref) => secrets.get(ref),
          onChunk: (c) => { if (c.kind === 'delta') full += c.delta; sendChunk(c); }
        });
        if (full) await chatService.appendMessage(sessionId, 'assistant', full);
        getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId, error: msg });
      }
      return { ok: true };
    }
  };
}
