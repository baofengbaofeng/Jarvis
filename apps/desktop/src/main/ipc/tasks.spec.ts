import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { EngineChatFn } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { registerTaskHandlers, type TaskHandlerDeps } from './tasks';
import { createAgentStore } from './agents';
import { createChatService } from '@jarvis/core';
import { createChatDbAdapter } from './chat';
import type { SecureStorage } from '../secrets/SecureStorage';

const fakeEvent = {} as Electron.IpcMainInvokeEvent;

describe('task handlers', () => {
  let db: Database.Database;
  const getWindow = () => null;
  const secrets = { set: async () => {}, get: async () => 'sk-test', delete: async () => {} } as unknown as SecureStorage;

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  function seedAgent(): string {
    const now = new Date().toISOString();
    const providerId = randomUUID();
    const modelId = randomUUID();
    const agentId = randomUUID();
    db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(providerId, 'P', 'openai-compatible', 'https://x.com', `provider:${providerId}:key`, now, now);
    db.prepare('INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES (?,?,?,?,?)')
      .run(modelId, providerId, 'm-1', 'M1', now);
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(agentId, 'A', `a-${agentId}`, '', 'sys', modelId, null, 128000, 0, JSON.stringify({ FOO: 'bar' }), JSON.stringify([]), now, now);
    return agentId;
  }

  it('creates a task, records the prompt into the chat session, and appends the assistant result on completion', async () => {
    const chatFn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'delta', delta: 'Hello' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'Hello', usage: null };
    };
    const deps: TaskHandlerDeps = { chatFn };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), deps);

    const chatService = createChatService(createChatDbAdapter(db));
    const session = await chatService.createSession('Test');
    const agentId = seedAgent();

    const { id } = await tasks.create(fakeEvent, { agentId, prompt: 'hi', sessionId: session.id });

    // A task row exists and the user prompt was persisted immediately.
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as { status: string; agent_id: string };
    expect(row.agent_id).toBe(agentId);
    const afterCreate = await chatService.loadMessages(session.id);
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0].role).toBe('user');
    expect(afterCreate[0].content).toBe('hi');

    // The injected chatFn completes the task; the assistant turn lands in the
    // same session once onDone fires.
    await vi.waitFor(async () => {
      const msgs = await chatService.loadMessages(session.id);
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Hello');
    });
    const finished = db.prepare('SELECT status, result_json FROM tasks WHERE id = ?').get(id) as { status: string; result_json: string };
    expect(finished.status).toBe('completed');
    expect(JSON.parse(finished.result_json)).toEqual({ text: 'Hello' });
  });

  it('throws when the agent has no model binding and writes nothing to the session', async () => {
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db));
    const chatService = createChatService(createChatDbAdapter(db));
    const session = await chatService.createSession('Test');
    const agentStore = createAgentStore(db);
    const a = agentStore.create({ name: 'No Model', systemPrompt: '', modelId: null, workspaceId: null });

    await expect(tasks.create(fakeEvent, { agentId: a.id, prompt: 'hi', sessionId: session.id }))
      .rejects.toThrow('agent has no valid model binding');
    expect(await chatService.loadMessages(session.id)).toHaveLength(0);
  });
});
