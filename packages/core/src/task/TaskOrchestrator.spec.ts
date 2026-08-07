import { describe, it, expect } from 'vitest';
import { TaskOrchestrator, type TaskStoreAdapter } from './TaskOrchestrator';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import type { AgentConfig } from '@jarvis/protocol';

const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: '', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

function makeStore(): { store: TaskStoreAdapter; states: string[] } {
  const states: string[] = [];
  return {
    states,
    store: {
      async create(_id) {},
      async updateState(_id, state) { states.push(state); },
      async appendLog() {}
    }
  };
}

describe('TaskOrchestrator', () => {
  it('runs a task to completion', async () => {
    const reg = new ToolRegistry();
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { o.onChunk?.({ kind: 'done' }); return { text: 'ok', usage: null }; } }, toolRegistry: reg });
    const { store, states } = makeStore();
    const done = new Promise<void>((res) => {
      const orb = new TaskOrchestrator(engine, store, { onDone: () => res() }, 1);
      orb.submit({ id: 't1', agent, messages: [{ role: 'user', content: 'x' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    });
    await done;
    expect(states).toEqual(['running', 'completed']);
  });

  it('respects per-agent concurrency cap', async () => {
    let active = 0; let peak = 0;
    const reg = new ToolRegistry();
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; o.onChunk?.({ kind: 'done' }); return { text: '', usage: null }; } }, toolRegistry: reg });
    const { store } = makeStore();
    let finished = 0;
    const orb = new TaskOrchestrator(engine, store, { onDone: () => { finished++; } }, 2);
    for (let i = 0; i < 5; i++) orb.submit({ id: `t${i}`, agent, messages: [], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'x' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 100));
    expect(peak).toBeLessThanOrEqual(2);
    expect(finished).toBe(5);
  });

  it('persists pause to the store and still completes a paused task that finishes', async () => {
    const reg = new ToolRegistry();
    let releaseChat!: () => void;
    const chatGate = new Promise<void>((res) => { releaseChat = res; });
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { await chatGate; o.onChunk?.({ kind: 'done' }); return { text: 'ok', usage: null }; } }, toolRegistry: reg });
    const { store, states } = makeStore();
    let doneRes!: () => void;
    const done = new Promise<void>((res) => { doneRes = res; });
    const orb = new TaskOrchestrator(engine, store, { onDone: () => doneRes() }, 1);
    orb.submit({ id: 't1', agent, messages: [{ role: 'user', content: 'x' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 0)); // let the engine enter the running state
    await orb.pause('t1');
    expect(states).toContain('paused');
    releaseChat();
    await done;
    expect(states).toContain('completed');
  });

  it('stops further model/tool calls while paused until resume (CORE-22)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let chatCalls = 0;
    let toolCalls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((res) => { releaseFirst = res; });
    const engine = new AgentEngine({
      modelRouter: {
        chat: async (_r, o) => {
          chatCalls++;
          if (chatCalls === 1) {
            await firstGate;
            o.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 't1', name: 'echo', arguments: {} }] });
            o.onChunk?.({ kind: 'done' });
            return { text: '', usage: null };
          }
          o.onChunk?.({ kind: 'delta', delta: 'done' });
          o.onChunk?.({ kind: 'done' });
          return { text: 'done', usage: null };
        }
      },
      toolRegistry: reg,
      maxSteps: 3,
    });
    // Count tool executions via a wrapping registry execute — register already did.
    const orig = reg.execute.bind(reg);
    reg.execute = async (call, ctx) => { toolCalls++; return orig(call, ctx); };
    const { store } = makeStore();
    let doneRes!: () => void;
    const done = new Promise<void>((res) => { doneRes = res; });
    const orb = new TaskOrchestrator(engine, store, { onDone: () => doneRes() }, 1);
    orb.submit({ id: 't1', agent, messages: [{ role: 'user', content: 'x' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 0));
    await orb.pause('t1');
    releaseFirst();
    // While paused, the first chat may finish but tool + next model must wait.
    await new Promise(r => setTimeout(r, 30));
    expect(toolCalls).toBe(0);
    expect(chatCalls).toBe(1);
    orb.resume('t1');
    await done;
    expect(toolCalls).toBe(1);
    expect(chatCalls).toBe(2);
  });

  it('cancel applies the store write to a paused task', async () => {
    const reg = new ToolRegistry();
    // A never-resolving chat keeps the task in 'running' so pause is observed.
    const never = new Promise<void>(() => {});
    const engine = new AgentEngine({ modelRouter: { chat: async () => { await never; return { text: '', usage: null }; } }, toolRegistry: reg });
    const { store, states } = makeStore();
    const orb = new TaskOrchestrator(engine, store, {}, 1);
    orb.submit({ id: 't1', agent, messages: [], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 0));
    await orb.pause('t1');
    await orb.cancel('t1');
    expect(states).toContain('cancelled');
  });

  it('does not clobber a cancel that lands during the queued->running store write', async () => {
    const reg = new ToolRegistry();
    let resolveStart!: () => void;
    const startGate = new Promise<void>((res) => { resolveStart = res; });
    const states: string[] = [];
    const store = {
      async create() {},
      async updateState(_id: string, state: string) { if (state === 'running') await startGate; states.push(state); },
      async appendLog() {}
    } as TaskStoreAdapter;
    let chatCalls = 0;
    let cancelled = 0;
    const engine = new AgentEngine({ modelRouter: { chat: async () => { chatCalls++; return { text: '', usage: null }; } }, toolRegistry: reg });
    const orb = new TaskOrchestrator(engine, store, {
      onStateChange: (_id, st) => { if (st === 'cancelled') cancelled++; }
    }, 1);
    orb.submit({ id: 't1', agent, messages: [], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 0)); // runOne is awaiting the held 'running' store write
    await orb.cancel('t1');
    resolveStart();
    await new Promise(r => setTimeout(r, 10));
    expect(cancelled).toBe(1);
    expect(chatCalls).toBe(0); // the aborted engine never started
    expect(states).not.toContain('failed');
    expect(states).not.toContain('completed');
  });

  it('retries a failed task and runs it to completion', async () => {
    let calls = 0;
    const reg = new ToolRegistry();
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { calls++; if (calls === 1) throw new Error('boom'); o.onChunk?.({ kind: 'done' }); return { text: 'ok', usage: null }; } }, toolRegistry: reg });
    const { store } = makeStore();
    const seen: string[] = [];
    let failedRes!: () => void;
    let doneRes!: () => void;
    const failed = new Promise<void>((res) => { failedRes = res; });
    const done = new Promise<void>((res) => { doneRes = res; });
    const orb = new TaskOrchestrator(engine, store, {
      onStateChange: (_id, state) => {
        seen.push(state);
        if (state === 'failed') failedRes();
        if (state === 'completed') doneRes();
      }
    }, 1);
    orb.submit({ id: 't1', agent, messages: [{ role: 'user', content: 'x' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    await failed;
    await orb.retry('t1');
    await done;
    expect(calls).toBe(2);
    expect(seen).toEqual(['queued', 'running', 'failed', 'queued', 'running', 'completed']);
  });
});
