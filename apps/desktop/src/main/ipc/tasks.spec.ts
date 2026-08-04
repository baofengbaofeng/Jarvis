import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { EngineChatFn } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { registerTaskHandlers, type TaskHandlerDeps } from './tasks';
import { createAgentStore } from './agents';
import { createSettingsStore } from './settings';
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

  it('enforces the per-agent permission policy saved by the permissions UI (C6/J6)', async () => {
    // Seed a readonly policy for the agent via the settings store — the same
    // shape PermissionsSettingsPage writes under settings.permissions.{agentId}.
    const settings = createSettingsStore(db);
    const agentId = seedAgent();
    settings.set(`permissions.${agentId}`, { level: 'readonly', allowCommands: [], allowDomains: [] });

    // The model emits one write_file call; the readonly policy must make the
    // file tool's sandbox reject the write and fail the task.
    let step = 0;
    const fn: EngineChatFn = async (_req, opts) => {
      step++;
      if (step === 1) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } }] });
      else opts.onChunk?.({ kind: 'done' });
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn, settings });
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status, result_json FROM tasks').all() as Array<{ status: string; result_json: string }>;
      expect(row[0].status).toBe('failed');
      expect(JSON.parse(row[0].result_json).text).toContain('readonly sandbox');
    });
  });

  it('a readwrite policy saved in settings lets commands a readonly policy rejects', async () => {
    // Contrast with the readonly case: the same settings key carrying level
    // 'readwrite' lets `mkdir` (readwrite-only whitelist) run and the task
    // complete. Uses a temp dir so the command has no repo side effects.
    const settings = createSettingsStore(db);
    const agentId = seedAgent();
    settings.set(`permissions.${agentId}`, { level: 'readwrite', allowCommands: [], allowDomains: [] });
    const target = mkdtempSync(join(tmpdir(), 'jarvis-mk-'));
    try {
      let step = 0;
      const fn: EngineChatFn = async (_req, opts) => {
        step++;
        if (step === 1) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'run_shell', arguments: { command: `mkdir -p ${join(target, 'sub')}` } }] });
        else opts.onChunk?.({ kind: 'done' });
        return { text: 'done', usage: null };
      };
      const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn, settings });
      await tasks.create(fakeEvent, { agentId, prompt: 'go' });
      await vi.waitFor(() => {
        const row = db.prepare('SELECT status FROM tasks').all() as Array<{ status: string }>;
        expect(row[0].status).toBe('completed');
      });
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('strips parsed @mentions, injects resolved context, skips unresolved with an audit warning (E6)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-mention-'));
    try {
      writeFileSync(join(ws, 'notes.txt'), 'hello from notes');
      let userContent = '';
      const fn: EngineChatFn = async (req, opts) => {
        userContent = req.messages.find(m => m.role === 'user')?.content ?? '';
        opts.onChunk?.({ kind: 'delta', delta: 'ok' });
        opts.onChunk?.({ kind: 'done' });
        return { text: 'ok', usage: null };
      };
      const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
      const agentId = seedAgent();
      db.prepare('UPDATE agents SET workspace_id = ? WHERE id = ?').run(ws, agentId);
      const { id } = await tasks.create(fakeEvent, { agentId, prompt: 'read @notes.txt and @nope.ts plus foo@bar.com please' });
      // Resolved mention context is injected into the model message.
      await vi.waitFor(() => expect(userContent).toContain('hello from notes'));
      expect(userContent).toContain('[file] notes.txt');
      expect(userContent).toContain('<referenced>');
      // Mid-word @ survives untouched; the parsed-but-unresolved mention is
      // stripped and skipped (never fatal).
      expect(userContent).toContain('foo@bar.com');
      expect(userContent).not.toContain('@nope.ts');
      // The skip is audited under kind 'mention'.
      const audit = db.prepare('SELECT detail_json FROM audit_logs WHERE kind = ?').all('mention') as Array<{ detail_json: string }>;
      expect(audit.map(a => (JSON.parse(a.detail_json) as { query: string }).query)).toContain('nope.ts');
      await vi.waitFor(async () => {
        const r = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string };
        expect(r.status).toBe('completed');
      });
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('approval gate wiring (M3 Task 7)', () => {
  let db: Database.Database;
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
      .run(agentId, 'A', `a-${agentId}`, '', 'sys', modelId, null, 128000, 0, JSON.stringify({}), JSON.stringify([]), now, now);
    return agentId;
  }

  function captureApprovals() {
    const approvals: Array<{ id: string; toolName: string }> = [];
    const getWindow = () => ({ webContents: { send: (ch: string, p: unknown) => { if (ch === 'approval:request') approvals.push(p as { id: string; toolName: string }); } } }) as unknown as BrowserWindow;
    return { approvals, getWindow };
  }

  it('routes git_commit through interactive approval', async () => {
    const { approvals, getWindow } = captureApprovals();
    let step = 0;
    const fn: EngineChatFn = async (_req, opts) => {
      step++;
      if (step === 1) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'git_commit', arguments: { message: 'x' } }] });
      else opts.onChunk?.({ kind: 'done' });
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const agentId = seedAgent();
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    // git_commit is not in allowAlways, so it must be flagged for approval.
    await vi.waitFor(() => expect(approvals.length).toBe(1));
    expect(approvals[0].toolName).toBe('git_commit');
    // Deny: the engine records a denied tool turn; the task still completes.
    tasks.approvalCenter.resolve(approvals[0].id, false);
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks').all() as Array<{ status: string }>;
      expect(row[0].status).toBe('completed');
    });
  });

  it('writes an mcp_grants row when an mcp tool call is approved', async () => {
    const { approvals, getWindow } = captureApprovals();
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'mcp:fs:read', arguments: { path: '/' } }] });
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const agentId = seedAgent();
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => expect(approvals.length).toBe(1));
    expect(approvals[0].toolName).toBe('mcp:fs:read');
    tasks.approvalCenter.resolve(approvals[0].id, true);
    // The grant is written inside the approval gate even though the tool is not
    // registered in this test (the task then fails on execution — irrelevant).
    await vi.waitFor(() => {
      const g = db.prepare('SELECT server_id, tool_name, granted FROM mcp_grants').all() as Array<{ server_id: string; tool_name: string; granted: number }>;
      expect(g).toHaveLength(1);
      expect(g[0]).toEqual({ server_id: 'fs', tool_name: 'read', granted: 1 });
    });
  });

  it('auto-allows a previously granted mcp tool without a new approval', async () => {
    // Seed a grant so the next mcp:fs:read call hits allowAlways.
    db.prepare('INSERT INTO mcp_grants (id, agent_id, server_id, tool_name, granted, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), '', 'fs', 'read', 1, new Date().toISOString());
    const { approvals, getWindow } = captureApprovals();
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'mcp:fs:read', arguments: { path: '/' } }] });
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const agentId = seedAgent();
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    // The tool is unregistered in this test, so execution throws and the task
    // fails — but it must fail WITHOUT any approval:request (the grant short-
    // circuits the gate straight to execution).
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks').all() as Array<{ status: string }>;
      expect(row[0].status).toBe('failed');
    });
    expect(approvals.length).toBe(0);
  });
});
