import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { contentHasImages, createChatService, gateModelCapabilities, ModelRouter } from '@jarvis/core';
import type { MessageContent } from '@jarvis/core';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig, ChatRole } from '@jarvis/protocol';
import type { UsageTracker } from '../usage/UsageTracker';

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
    async deleteSession(sessionId: string) {
      db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
    },
    async renameSession(sessionId: string, title: string) {
      const updatedAt = now();
      const result = db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, updatedAt, sessionId);
      if (result.changes === 0) throw new Error(`session not found: ${sessionId}`);
      const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as Record<string, unknown>;
      return {
        id: row.id as string,
        title: row.title as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
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

export function registerChatHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, deps: { router?: ModelRouter; usageTracker?: UsageTracker } = {}) {
  const dbAdapter = createChatDbAdapter(db);
  const chatService = createChatService(dbAdapter);
  const router = deps.router ?? new ModelRouter();

  return {
    async listSessions() { return chatService.listSessions(); },
    async createSession(title?: string) { return chatService.createSession(title); },
    async deleteSession(sessionId: string) { return chatService.deleteSession(sessionId); },
    async renameSession(sessionId: string, title: string) { return chatService.renameSession(sessionId, title); },
    async loadMessages(sessionId: string) { return chatService.loadMessages(sessionId); },

    async send(_event: Electron.IpcMainInvokeEvent, args: { sessionId: string; agentId: string; text?: string; content?: string | MessageContent }) {
      const { sessionId, agentId } = args;
      // L23: the renderer may attach images and send a content array under
      // `content`. `text` is retained for backward compatibility with existing
      // callers (the M1 IPC contract and chat.spec fixtures); string behavior is
      // identical either way.
      const content = args.content ?? args.text ?? '';
      await chatService.appendMessage(sessionId, 'user', content);
      const history = await chatService.loadMessages(sessionId);
      const agent = await dbAdapter.loadAgent(agentId);
      const binding = db.prepare(`
        SELECT p.*, m.model_id AS api_model_id, m.enabled AS model_enabled, p.enabled AS provider_enabled,
               m.max_output_tokens AS max_output_tokens, m.supports_tools AS supports_tools,
               m.supports_images AS supports_images
        FROM providers p JOIN models m ON m.provider_id = p.id WHERE m.id = ?
      `).get(agent.modelId) as Record<string, unknown> | undefined;
      if (!binding) throw new Error('agent has no valid model/provider binding');
      if (Number(binding.provider_enabled ?? 1) !== 1) throw new Error('PROVIDER_DISABLED');
      if (Number(binding.model_enabled ?? 1) !== 1) throw new Error('MODEL_DISABLED');
      const provider = binding;
      const sendChunk = (chunk: unknown) => { getWindow()?.webContents.send(IpcEvent.chatDelta, { sessionId, chunk }); };
      const modelMessages = chatService.buildModelMessages(history, agent.systemPrompt);
      const gate = gateModelCapabilities({
        capabilities: {
          maxOutputTokens: (binding.max_output_tokens as number | null) ?? null,
          supportsTools: Number(binding.supports_tools ?? 1) === 1,
          supportsImages: Number(binding.supports_images ?? 0) === 1,
        },
        hasToolsAvailable: false,
        hasImages: contentHasImages(content) || modelMessages.some((m) => contentHasImages(m.content)),
      });
      if (gate.error) {
        getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId, error: gate.error });
        return { ok: false as const, error: gate.error };
      }

      let full = '';
      try {
        const modelId = binding.api_model_id as string;
        await router.chat({
          provider: {
            id: provider.id as string,
            name: provider.name as string,
            type: provider.type as 'openai-compatible' | 'anthropic-compatible',
            baseUrl: provider.base_url as string,
            apiKeyRef: provider.api_key_ref as string,
            enabled: Number(provider.enabled ?? 1) === 1,
            createdAt: provider.created_at as string,
            updatedAt: provider.updated_at as string,
          },
          modelId,
          messages: modelMessages,
          stream: true,
          maxTokens: gate.maxTokens,
        }, {
          apiKeyResolver: async (ref) => secrets.get(ref),
          onChunk: (c) => {
            if (c.kind === 'delta') full += c.delta;
            // M8 Task 2 (B9): best-effort token telemetry from the streaming
            // usage chunk. The model id is the actual string passed to the
            // router above.
            if (c.kind === 'usage') {
              // M8 final review: telemetry is best-effort — a tracker throw must
              // not abort the chat stream.
              try { deps.usageTracker?.track({ sessionId, agentId, modelId, ...c.usage }); } catch { /* best-effort telemetry */ }
            }
            sendChunk(c);
          }
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
