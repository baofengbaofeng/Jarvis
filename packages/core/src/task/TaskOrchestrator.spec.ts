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
});
