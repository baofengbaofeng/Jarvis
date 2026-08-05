import { describe, it, expect, vi } from 'vitest';
import { createGuard, checkDelegate, finishDelegate, cycleKey, registerDelegateTool } from './Delegate';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('delegate guard', () => {
  it('blocks beyond max depth', () => {
    const g = createGuard(2);
    checkDelegate(g, 'a', 'b', 'h');
    checkDelegate(g, 'b', 'c', 'h');
    expect(() => checkDelegate(g, 'c', 'd', 'h')).toThrow('depth');
  });

  it('detects delegation cycles on same (from,to,taskHash)', () => {
    const g = createGuard(5);
    checkDelegate(g, 'a', 'b', 'h1');
    expect(() => checkDelegate(g, 'a', 'b', 'h1')).toThrow('cycle');
    expect(() => checkDelegate(g, 'a', 'b', 'h2')).not.toThrow();
  });

  it('cycleKey combines from, to, and taskHash', () => {
    expect(cycleKey('a', 'b', 'h')).toBe('a->b#h');
  });

  it('finishDelegate returns a depth slot', () => {
    const g = createGuard(1);
    checkDelegate(g, 'a', 'b', 'h');
    finishDelegate(g);
    expect(() => checkDelegate(g, 'b', 'c', 'h')).not.toThrow();
  });

  it('registers a delegate_agent tool that routes and guards', async () => {
    const reg = new ToolRegistry();
    const guard = createGuard(5);
    const route = vi.fn(async () => 'member result');
    registerDelegateTool(reg, { guard, route, fromAgent: () => 'leader', taskHash: () => 'h', taskId: () => 't1' });
    const r = await reg.execute({ id: '1', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'write tests' } }, { cwd: '/', env: {} });
    expect(r.output).toContain('member result');
    expect(route).toHaveBeenCalledWith('member', 'write tests', 'leader', 't1');
  });

  // M6 final review (finding 2): taskHash receives the SUBTASK so two distinct
  // subtasks delegated to the same member get distinct guard keys — the old
  // constant task-id hash collapsed every delegation to leader->member#squadId
  // and spurious-flagged the second one as a cycle.
  it('taskHash receives the subtask so distinct subtasks to the same member do not collide', async () => {
    const g = createGuard(5);
    const seen: string[] = [];
    const hashes = vi.fn((subtask: string) => { seen.push(subtask); return `h:${subtask}`; });
    const reg = new ToolRegistry();
    const route = vi.fn(async () => 'ok');
    registerDelegateTool(reg, { guard: g, route, fromAgent: () => 'leader', taskHash: hashes, taskId: () => 't1' });
    await reg.execute({ id: '1', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'alpha' } }, { cwd: '/', env: {} });
    await reg.execute({ id: '2', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'beta' } }, { cwd: '/', env: {} });
    // finishDelegate pruned each key, so the second delegation is NOT a cycle.
    expect(hashes).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['alpha', 'beta']);
    expect(route).toHaveBeenCalledTimes(2);
  });

  // M6 final review (finding 2): finishDelegate prunes the visited key it
  // added, so a single shared guard does not accumulate every delegation of a
  // long squad run (bounded by the active depth instead).
  it('finishDelegate prunes the visited cycle key', () => {
    const g = createGuard(5);
    checkDelegate(g, 'a', 'b', 'h');
    expect(g.visited.size).toBe(1);
    finishDelegate(g);
    expect(g.visited.size).toBe(0);
    expect(g.depth).toBe(0);
  });

  // M6 final review (finding 3): fromAgent resolves the RUN's agent from the
  // tool context (ctx.agent) when present, falling back to the baked id — so a
  // shared registry attributes the delegation to whoever actually issued it.
  it('fromAgent receives ctx and prefers ctx.agent when present', async () => {
    const reg = new ToolRegistry();
    const guard = createGuard(5);
    const route = vi.fn(async () => 'ok');
    const fromSpy = vi.fn((ctx: { agent?: { id: string } }) => ctx.agent?.id ?? 'baked');
    registerDelegateTool(reg, { guard, route, fromAgent: fromSpy, taskHash: () => 'h', taskId: () => 't1' });
    // A full AgentConfig for ctx.agent (protocol's structural type).
    const runner = { id: 'runner', name: 'r', slug: 'r', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 0, planOnly: false, createdAt: '', updatedAt: '' };
    await reg.execute({ id: '1', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'x' } }, { cwd: '/', env: {}, agent: runner });
    expect(route).toHaveBeenCalledWith('member', 'x', 'runner', 't1');
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});
