import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { AgentEngine, ToolRegistry, TaskOrchestrator, createAdapter, buildContextMessages } from '@jarvis/core';
import type { EngineChatFn, Usage } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createWorkspaceService } from './workspace';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig } from '@jarvis/protocol';

export function registerTaskHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, agentStore = createAgentStore(db)) {
  const workspace = createWorkspaceService(db);
  // The model adapters stream deltas via onChunk and return void, while
  // EngineChatFn must RETURN { text, usage } (the AgentEngine destructures it).
  // Wrap the adapter so delta text is accumulated, the usage chunk is captured,
  // every chunk is forwarded to opts.onChunk, and opts.signal is passed through.
  const adapter = createAdapter('openai-compatible');
  const chatFn: EngineChatFn = async (req, opts) => {
    let text = '';
    let usage: Usage | null = null;
    await adapter.chat(req, {
      apiKey: opts.apiKey,
      signal: opts.signal,
      onChunk: (c) => {
        if (c.kind === 'delta') text += c.delta;
        else if (c.kind === 'usage') usage = c.usage;
        opts.onChunk?.(c);
      }
    });
    return { text, usage };
  };
  const engine = new AgentEngine({ modelRouter: { chat: chatFn }, toolRegistry: new ToolRegistry(), maxSteps: 10 });
  const store = {
    async create(id: string, agentId: string) {
      db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run(id, agentId, 'queued', '{}', new Date().toISOString());
    },
    async updateState(id: string, state: string) { db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(state, id); },
    async appendLog(id: string, line: string) { getWindow()?.webContents.send(IpcEvent.taskLog, { id, line }); }
  };

  const orchestrator = new TaskOrchestrator(engine, store, {
    onStateChange: (id, state) => { getWindow()?.webContents.send(IpcEvent.taskState, { id, state }); },
    onLog: (id, line) => { getWindow()?.webContents.send(IpcEvent.taskLog, { id, line }); },
    onDone: (id, ok, text) => {
      db.prepare('UPDATE tasks SET status = ?, result_json = ?, completed_at = ? WHERE id = ?').run(ok ? 'completed' : 'failed', JSON.stringify({ text }), new Date().toISOString(), id);
      getWindow()?.webContents.send(ok ? IpcEvent.taskComplete : IpcEvent.taskFailed, { id, text });
    }
  }, 6);

  return {
    async create(_event: Electron.IpcMainInvokeEvent, args: { agentId: string; prompt: string }) {
      const { agentId, prompt } = args;
      const id = randomUUID();
      const agent = agentStore.get(agentId);
      const ctx = workspace.loadContext(agentId);
      const messages = buildTaskMessages(ctx, agent, prompt);
      const modelRow = db.prepare('SELECT m.model_id, p.base_url, p.type, p.api_key_ref FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?').get(agent.modelId) as { model_id: string; base_url: string; type: 'openai-compatible' | 'anthropic-compatible'; api_key_ref: string } | undefined;
      if (!modelRow) throw new Error('agent has no valid model binding');
      const apiKey = await secrets.get(modelRow.api_key_ref);
      if (!apiKey) throw new Error('missing api key');
      await store.create(id, agentId);
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env: {}, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
    resume: (_e: unknown, id: string) => orchestrator.resume(id),
    retry: (_e: unknown, id: string) => orchestrator.retry(id)
  };
}

function buildTaskMessages(ctx: { jarvisMd: string; agentMd: string | null }, agent: AgentConfig, prompt: string): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  return buildContextMessages(ctx, agent.systemPrompt, [{ role: 'user', content: prompt }]);
}
