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
    registerDelegateTool(reg, { guard, route, fromAgent: 'leader', taskHash: () => 'h', taskId: () => 't1' });
    const r = await reg.execute({ id: '1', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'write tests' } }, { cwd: '/', env: {} });
    expect(r.output).toContain('member result');
    expect(route).toHaveBeenCalledWith('member', 'write tests', 'leader', 't1');
  });
});
