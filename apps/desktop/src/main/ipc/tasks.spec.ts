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
import { createMemoryAdapter } from './memory';
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

  // M8 Task 10 (K6): a completed task's final text is captured into
  // task_artifacts (markdown tables + ```mermaid blocks) so the /canvas view can
  // render them. Best-effort — a capture/save failure must never break task
  // completion (the task row is written before the capture runs).
  it('captures tables and mermaid blocks from the result text into task_artifacts (K6)', async () => {
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'delta', delta: '| H |\n|---|\n| 9 |\n\n```mermaid\ngraph LR; A-->B\n```' });
      opts.onChunk?.({ kind: 'done' });
      return { text: '| H |\n|---|\n| 9 |\n\n```mermaid\ngraph LR; A-->B\n```', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const agentId = seedAgent();
    const { id } = await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string };
      expect(row.status).toBe('completed');
    });
    const arts = db.prepare('SELECT task_id, kind, content FROM task_artifacts ORDER BY id').all() as Array<{ task_id: string; kind: string; content: string }>;
    expect(arts.map(a => a.kind)).toEqual(['table', 'mermaid']);
    expect(arts[0].task_id).toBe(id);
    expect(arts[0].content).toBe('| H |\n|---|\n| 9 |');
    expect(arts[1].content).toBe('graph LR; A-->B');
  });

  // M8 Task 10 (K6): a task with plain prose result degrades to a single
  // markdown artifact; an empty result writes nothing (captureArtifacts []).
  it('captures a markdown fallback for prose and nothing for empty results (K6)', async () => {
    let run = 0;
    const fn: EngineChatFn = async (_req, opts) => {
      // First run returns prose; the second task run returns empty text.
      run++;
      const text = run === 1 ? 'prose result' : '';
      opts.onChunk?.({ kind: 'delta', delta: text });
      opts.onChunk?.({ kind: 'done' });
      return { text, usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const agentId = seedAgent();
    const first = await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(first.id) as { status: string };
      expect(row.status).toBe('completed');
    });
    const second = await tasks.create(fakeEvent, { agentId, prompt: 'go again' });
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(second.id) as { status: string };
      expect(row.status).toBe('completed');
    });
    const arts = db.prepare('SELECT task_id, kind FROM task_artifacts ORDER BY id').all() as Array<{ task_id: string; kind: string }>;
    // The prose run produced a markdown artifact; the empty run produced none.
    expect(arts.filter(a => a.task_id === first.id).map(a => a.kind)).toEqual(['markdown']);
    expect(arts.some(a => a.task_id === second.id)).toBe(false);
  });

  // M6 Task 7 (F11): each run starts with the agent's persisted memories
  // appended to the system prompt. The injection is built fresh in
  // resolveAgentRun -> buildTaskMessages, so it reflects whatever was persisted
  // before the run.
  it('injects the agent persisted memory into the system prompt (F11)', async () => {
    const agentId = seedAgent();
    createMemoryAdapter(db).upsert(agentId, 'lang', 'zh');
    createMemoryAdapter(db).upsert(agentId, 'style', 'concise');
    let systemContent = '';
    const fn: EngineChatFn = async (req, opts) => {
      const s = req.messages.find(m => m.role === 'system')?.content;
      systemContent = typeof s === 'string' ? s : '';
      opts.onChunk?.({ kind: 'delta', delta: 'ok' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => expect(systemContent).toContain('<memory>'));
    expect(systemContent).toContain('lang: zh');
    expect(systemContent).toContain('style: concise');
  });

  // M6 Task 7 (F11): the memorize/recall tools registered in the task path
  // persist to the main-owned agent_memory table and read back the same value.
  // memorize auto-allows (no command arg, not plan-blocked), so the tool runs
  // without interactive approval.
  it('memorize/recall tools persist and read back agent memory through a task (F11)', async () => {
    const agentId = seedAgent();
    let step = 0;
    let recallOutput = '';
    const fn: EngineChatFn = async (req, opts) => {
      step++;
      if (step === 1) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'memorize', arguments: { key: 'pref', value: 'short answers' } }] });
      else if (step === 2) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '2', name: 'recall', arguments: {} }] });
      else {
        // The recall result is the LAST tool message in this turn's history
        // (the memorize result 'remembered' precedes it).
        const toolMsgs = req.messages.filter(m => m.role === 'tool');
        const last = toolMsgs[toolMsgs.length - 1]?.content;
        recallOutput = typeof last === 'string' ? last : '';
        opts.onChunk?.({ kind: 'done' });
      }
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => expect(recallOutput).toContain('pref: short answers'));
    // The memorize persisted to the agent_memory table via the adapter.
    const row = db.prepare('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?').get(agentId, 'pref') as { value: string };
    expect(row.value).toBe('short answers');
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
    // file tool's sandbox reject the write. CORE-06: the denial is returned as
    // ok:false to the model so the task completes (it does not kill the run).
    let step = 0;
    let toolOutput = '';
    const fn: EngineChatFn = async (req, opts) => {
      step++;
      if (step === 1) opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } }] });
      else {
        const last = [...req.messages].reverse().find(m => m.role === 'tool');
        toolOutput = typeof last?.content === 'string' ? last.content : '';
        opts.onChunk?.({ kind: 'done' });
      }
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn, settings });
    await tasks.create(fakeEvent, { agentId, prompt: 'go' });
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks').all() as Array<{ status: string }>;
      expect(row[0].status).toBe('completed');
      expect(toolOutput).toContain('readonly sandbox');
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
        // The task path is text-only, so extract the string part (L23 widened
        // ModelMessage.content to string | MessageContent).
        const c = req.messages.find(m => m.role === 'user')?.content;
        userContent = typeof c === 'string' ? c : '';
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
      // The skip is audited under kind 'mention' (v11 audit_logs shape: the
      // full payload lives in `detail`, not the v1 `detail_json`).
      const audit = db.prepare('SELECT detail FROM audit_logs WHERE kind = ?').all('mention') as Array<{ detail: string }>;
      expect(audit.map(a => (JSON.parse(a.detail) as { query: string }).query)).toContain('nope.ts');
      await vi.waitFor(async () => {
        const r = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string };
        expect(r.status).toBe('completed');
      });
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('task.resume returns resumed context messages for a completed task (E15)', async () => {
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'delta', delta: 'Hello' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'Hello', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const chatService = createChatService(createChatDbAdapter(db));
    const session = await chatService.createSession('Test');
    const agentId = seedAgent();
    const { id } = await tasks.create(fakeEvent, { agentId, prompt: 'hi', sessionId: session.id });

    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string };
      expect(row.status).toBe('completed');
    });
    // The session link was persisted into payload_json at create time.
    const row = db.prepare('SELECT payload_json FROM tasks WHERE id = ?').get(id) as { payload_json: string };
    expect((JSON.parse(row.payload_json) as { sessionId: string }).sessionId).toBe(session.id);

    const r = await tasks.resume(fakeEvent, id) as { ok: boolean; resumed: string; messages: Array<{ role: string; content: string }> };
    expect(r.ok).toBe(true);
    expect(r.resumed).toBe('context');
    // Both chat turns fit the agent budget, so the full history is returned.
    expect(r.messages.map(m => m.content)).toEqual(['hi', 'Hello']);
  });

  // M6 Task 3 (F8/F9) review finding 2: members are leaves (Multica SOP). During
  // a member run the delegate_agent tool must throw a clear DelegateGuardError
  // instead of being attributed to the leader and passing the cycle guard.
  it('blocks a member from delegating during a squad run (members are leaves)', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    const m2 = seedAgent();
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-mem', leaderId, JSON.stringify([m1, m2]), 'in_progress', null, new Date().toISOString());
    let leaderRan = false;
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (!leaderRan) {
          leaderRan = true;
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      if (req.provider.id === m1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '2', name: 'delegate_agent', arguments: { agent: m2, subtask: 'do y' } }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: '', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-mem', leaderAgentId: leaderId, memberAgentIds: [m1, m2], status: 'in_progress' });
    try {
      await expect(runner.runLeader('do the whole thing')).rejects.toThrow('members cannot delegate');
    } finally {
      runner.teardown();
    }
  });

  // The leader path is unaffected by the member-leaf guard: a leader delegation
  // runs a member through the shared engine and collects the delegation; the
  // member result is cached so runSquad's member loop does not re-run it.
  it('a leader delegation runs a member and collects the delegation', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-ok', leaderId, JSON.stringify([m1]), 'in_progress', null, new Date().toISOString());
    let leaderRan = false;
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (!leaderRan) {
          leaderRan = true;
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'delta', delta: 'member result text' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'member result text', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-ok', leaderAgentId: leaderId, memberAgentIds: [m1], status: 'in_progress' });
    try {
      const r = await runner.runLeader('do it');
      expect(r.delegations).toEqual([{ to: m1, subtask: 'do x' }]);
      await expect(runner.runMember(m1, 'do x', 'ctx')).resolves.toBe('member result text');
    } finally {
      runner.teardown();
    }
  });

  // M6 Task 5 (L14): a completed delegation writes one agent_call_edges row
  // (leader -> member, squad-scoped, ok=1) so squad.graph can render the chain.
  it('records a successful agent_call_edges row when a delegation completes (L14)', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-edge', leaderId, JSON.stringify([m1]), 'in_progress', null, new Date().toISOString());
    let leaderRan = false;
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (!leaderRan) {
          leaderRan = true;
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'delta', delta: 'member result text' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'member result text', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-edge', leaderAgentId: leaderId, memberAgentIds: [m1], status: 'in_progress' });
    try {
      await runner.runLeader('do it');
    } finally {
      runner.teardown();
    }
    const edge = db.prepare('SELECT from_agent, to_agent, task_id, squad_id, ok FROM agent_call_edges').get() as { from_agent: string; to_agent: string; task_id: string; squad_id: string; ok: number };
    expect(edge).toEqual({ from_agent: leaderId, to_agent: m1, task_id: 'sq-edge', squad_id: 'sq-edge', ok: 1 });
  });

  // M6 Task 5 (L14): a member run failure still records the edge with ok=0 so
  // squad.graph can label it 'failed'; the error rethrows so the leader's run
  // fails loudly (the graph write must never swallow the delegation error).
  it('records a failed agent_call_edges row when a member run throws (L14)', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-fail', leaderId, JSON.stringify([m1]), 'in_progress', null, new Date().toISOString());
    let leaderRan = false;
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (!leaderRan) {
          leaderRan = true;
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      throw new Error('member crashed');
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-fail', leaderAgentId: leaderId, memberAgentIds: [m1], status: 'in_progress' });
    try {
      await expect(runner.runLeader('do it')).rejects.toThrow('member crashed');
    } finally {
      runner.teardown();
    }
    const edge = db.prepare('SELECT from_agent, to_agent, task_id, squad_id, ok FROM agent_call_edges').get() as { from_agent: string; to_agent: string; task_id: string; squad_id: string; ok: number };
    expect(edge).toEqual({ from_agent: leaderId, to_agent: m1, task_id: 'sq-fail', squad_id: 'sq-fail', ok: 0 });
  });

  // M6 Task 4 (L13): the squad runner's buildContext applies the RECEIVING
  // member's context_passing strategy to the leader's delegation context.
  it('applies the member context_passing strategy in buildContext', async () => {
    const m1 = seedAgent();
    db.prepare('UPDATE agents SET context_passing = ? WHERE id = ?').run('conclusion', m1);
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db));
    const runner = tasks.squad;
    // conclusion drops everything except 结论/总结 lines.
    const ctx = await runner.buildContext(m1, '背景...\n结论:方案 A\n细节...\n总结:可行');
    expect(ctx).toContain('方案 A');
    expect(ctx).toContain('可行');
    expect(ctx).not.toContain('背景');
    // default (full) passes the text verbatim for an unconfigured member.
    const m2 = seedAgent();
    const ctx2 = await runner.buildContext(m2, 'whole text');
    expect(ctx2).toBe('whole text');
  });

  // M6 final review (finding 1): the strategy-processed leader context must
  // reach the MEMBER's PROMPT at DELEGATE time (delegateRoute), not be computed
  // only in runSquad's loop and discarded on the cached path. A 'summary' member
  // must see the truncated context — the raw leader input's tail (beyond the
  // 2000-char truncation) must be absent from what the member actually receives.
  it('passes the strategy-processed leader context to the member at delegate time (L13)', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    db.prepare('UPDATE agents SET context_passing = ? WHERE id = ?').run('summary', m1);
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-l13', leaderId, JSON.stringify([m1]), 'in_progress', null, new Date().toISOString());
    // 2000 'z's then a distinctive tail beyond the summary truncation point.
    const raw = 'z'.repeat(2000) + 'UNIQUE_TAIL_BEYOND_SUMMARY';
    let leaderPhase = 0;
    let memberPrompt = '';
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (leaderPhase === 0) {
          leaderPhase = 1;
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      // Member run: capture the user prompt it actually received.
      const c = req.messages.find(m => m.role === 'user')?.content;
      memberPrompt = typeof c === 'string' ? c : '';
      opts.onChunk?.({ kind: 'delta', delta: 'member result' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'member result', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-l13', leaderAgentId: leaderId, memberAgentIds: [m1], status: 'in_progress' });
    try {
      await runner.runLeader(raw);
    } finally {
      runner.teardown();
    }
    // The member prompt is the TRUNCATED context + the subtask — the tail beyond
    // the summary truncation point never reaches the member.
    expect(memberPrompt).toContain('[子任务]');
    expect(memberPrompt).toContain('do x');
    expect(memberPrompt).not.toContain('UNIQUE_TAIL_BEYOND_SUMMARY');
    expect(memberPrompt.length).toBeLessThan(2500);
  });

  // M6 final review (finding 3): within a single squad run the leader and member
  // share the tool registry, but each memorize must write to ITS OWN memory. The
  // member's re-registration (bound to m1) must NOT capture the leader's later
  // memorize — ctx.agent (threaded through AgentEngine.run) attributes each write.
  it('attributes memory writes to the run agent within a squad run (F11 per-run)', async () => {
    const leaderId = seedAgent();
    const m1 = seedAgent();
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('sq-memattr', leaderId, JSON.stringify([m1]), 'in_progress', null, new Date().toISOString());
    let leaderPhase = 0;
    const fn: EngineChatFn = async (req, opts) => {
      if (req.provider.id === leaderId) {
        if (leaderPhase === 0) {
          leaderPhase = 1;
          // Phase 1: delegate to m1 (member runs inline and memorizes).
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'delegate_agent', arguments: { agent: m1, subtask: 'do x' } }] });
        } else if (leaderPhase === 1) {
          leaderPhase = 2;
          // Phase 2: the leader's continuation memorizes — must go to the leader.
          opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '2', name: 'memorize', arguments: { key: 'leaderKey', value: 'leaderVal' } }] });
        }
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      // Member run: memorize, then done.
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '3', name: 'memorize', arguments: { key: 'memberKey', value: 'memberVal' } }] });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'member result', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-memattr', leaderAgentId: leaderId, memberAgentIds: [m1], status: 'in_progress' });
    try {
      await runner.runLeader('do it');
    } finally {
      runner.teardown();
    }
    const leaderRow = db.prepare('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?').get(leaderId, 'leaderKey') as { value: string } | undefined;
    expect(leaderRow?.value).toBe('leaderVal');
    const memberRow = db.prepare('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?').get(m1, 'memberKey') as { value: string } | undefined;
    expect(memberRow?.value).toBe('memberVal');
    // The leader's write must NOT land on the member's memory.
    const wrong = db.prepare('SELECT value FROM agent_memory WHERE agent_id = ? AND key = ?').get(m1, 'leaderKey') as { value: string } | undefined;
    expect(wrong).toBeUndefined();
  });

  // K5 (M6 Task 10): while a squad run is active, task log lines are ALSO
  // streamed onto the squad timeline ('squad:event'). A non-squad task keeps
  // its log on 'task:log' only — the squad:event push is gated on squadCtx.
  it('streams task log lines to squad:event while a squad run is active (K5)', async () => {
    const leaderId = seedAgent();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const getWindow = () => ({ webContents: { send: (ch: string, p: unknown) => sent.push({ channel: ch, payload: p }) } }) as unknown as BrowserWindow;
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'delta', delta: 'hello line' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    const runner = tasks.squad;
    runner.prepare({ id: 'sq-log', leaderAgentId: leaderId, memberAgentIds: [], status: 'in_progress' });
    try {
      await tasks.create(fakeEvent, { agentId: leaderId, prompt: 'go' });
    } finally {
      runner.teardown();
    }
    await vi.waitFor(() => {
      const events = sent.filter(e => e.channel === 'squad:event' && (e.payload as { kind: string }).kind === 'log');
      expect(events.length).toBeGreaterThan(0);
      expect((events[0].payload as { detail: string }).detail).toBe('hello line');
    });
  });

  it('keeps task logs off the squad timeline when no squad run is active', async () => {
    const leaderId = seedAgent();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const getWindow = () => ({ webContents: { send: (ch: string, p: unknown) => sent.push({ channel: ch, payload: p }) } }) as unknown as BrowserWindow;
    const fn: EngineChatFn = async (_req, opts) => {
      opts.onChunk?.({ kind: 'delta', delta: 'hello line' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), { chatFn: fn });
    await tasks.create(fakeEvent, { agentId: leaderId, prompt: 'go' });
    await vi.waitFor(() => {
      expect(sent.some(e => e.channel === 'task:log')).toBe(true);
    });
    expect(sent.filter(e => e.channel === 'squad:event')).toHaveLength(0);
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
    // The tool is unregistered in this test. CORE-06: unknown tools return
    // ok:false to the model (task completes) — but it must do so WITHOUT any
    // approval:request (the grant short-circuits the gate straight to execution).
    await vi.waitFor(() => {
      const row = db.prepare('SELECT status FROM tasks').all() as Array<{ status: string }>;
      expect(row[0].status).toBe('completed');
    });
    expect(approvals.length).toBe(0);
  });
});
