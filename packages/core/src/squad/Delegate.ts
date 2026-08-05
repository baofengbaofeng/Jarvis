import type { ToolRegistry } from '../agent/ToolRegistry';

export class DelegateGuardError extends Error {}
export interface DelegateGuardState { depth: number; visited: Set<string>; maxDepth: number }

export function createGuard(maxDepth = 5): DelegateGuardState {
  return { depth: 0, visited: new Set(), maxDepth };
}

export function cycleKey(from: string, to: string, taskHash: string): string {
  return `${from}->${to}#${taskHash}`;
}

export function checkDelegate(state: DelegateGuardState, from: string, to: string, taskHash: string): void {
  if (state.depth >= state.maxDepth) throw new DelegateGuardError(`max delegation depth ${state.maxDepth} exceeded`);
  const key = cycleKey(from, to, taskHash);
  if (state.visited.has(key)) throw new DelegateGuardError(`delegation cycle detected: ${key}`);
  state.visited.add(key);
  state.depth++;
}

export function finishDelegate(state: DelegateGuardState): void {
  state.depth = Math.max(0, state.depth - 1);
}

export interface DelegateToolDeps {
  guard: DelegateGuardState;
  route: (to: string, subtask: string, from: string, taskId: string) => Promise<string>;
  fromAgent: string;
  taskHash: () => string;
  taskId: () => string;
}

export function registerDelegateTool(registry: ToolRegistry, deps: DelegateToolDeps): void {
  registry.register({
    name: 'delegate_agent',
    description: 'Delegate a subtask to another agent and wait for its result',
    parameters: { type: 'object', properties: { agent: { type: 'string' }, subtask: { type: 'string' } }, required: ['agent', 'subtask'] }
  }, async (args) => {
    const to = String(args.agent);
    const subtask = String(args.subtask);
    checkDelegate(deps.guard, deps.fromAgent, to, deps.taskHash());
    try {
      const result = await deps.route(to, subtask, deps.fromAgent, deps.taskId());
      return { ok: true, output: result };
    } finally {
      finishDelegate(deps.guard);
    }
  });
}
