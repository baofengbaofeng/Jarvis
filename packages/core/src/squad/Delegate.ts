import type { ToolRegistry } from '../agent/ToolRegistry';
import type { ToolContext } from '../agent/types';

export class DelegateGuardError extends Error {}
export interface DelegateGuardState { depth: number; visited: Set<string>; maxDepth: number; stack: string[] }

export function createGuard(maxDepth = 5): DelegateGuardState {
  return { depth: 0, visited: new Set(), maxDepth, stack: [] };
}

export function cycleKey(from: string, to: string, taskHash: string): string {
  return `${from}->${to}#${taskHash}`;
}

export function checkDelegate(state: DelegateGuardState, from: string, to: string, taskHash: string): void {
  if (state.depth >= state.maxDepth) throw new DelegateGuardError(`max delegation depth ${state.maxDepth} exceeded`);
  const key = cycleKey(from, to, taskHash);
  if (state.visited.has(key)) throw new DelegateGuardError(`delegation cycle detected: ${key}`);
  state.visited.add(key);
  // M6 final review (finding 2): the stack mirrors the ACTIVE delegation path so
  // finishDelegate can prune visited. One squad run shares a single guard, so
  // without pruning visited grows unbounded across every delegation; with it,
  // cycle detection is scoped to the current stack (a true ancestor cycle), and
  // non-nested repeated delegations of the same (from,to,hash) are NOT false
  // positives.
  state.stack.push(key);
  state.depth++;
}

export function finishDelegate(state: DelegateGuardState): void {
  state.depth = Math.max(0, state.depth - 1);
  const key = state.stack.pop();
  if (key) state.visited.delete(key);
}

export interface DelegateToolDeps {
  guard: DelegateGuardState;
  route: (to: string, subtask: string, from: string, taskId: string) => Promise<string>;
  // Resolves the delegating agent. Receives the tool ctx so a shared registry
  // can attribute the delegation to the RUN's agent (ctx.agent) when present,
  // falling back to the baked identity (M6 final review finding 3).
  fromAgent: (ctx: ToolContext) => string;
  // Hashes the delegation so distinct subtasks to the same member do not
  // collide (M6 final review finding 2). The subtask is passed through so the
  // guard key discriminates leader->member#subtaskHash instead of collapsing to
  // a constant squad id.
  taskHash: (subtask: string) => string;
  taskId: () => string;
}

export function registerDelegateTool(registry: ToolRegistry, deps: DelegateToolDeps): void {
  registry.register({
    name: 'delegate_agent',
    description: 'Delegate a subtask to another agent and wait for its result',
    parameters: { type: 'object', properties: { agent: { type: 'string' }, subtask: { type: 'string' } }, required: ['agent', 'subtask'] }
  }, async (args, ctx) => {
    const to = String(args.agent);
    const subtask = String(args.subtask);
    const from = deps.fromAgent(ctx);
    checkDelegate(deps.guard, from, to, deps.taskHash(subtask));
    try {
      const result = await deps.route(to, subtask, from, deps.taskId());
      return { ok: true, output: result };
    } finally {
      finishDelegate(deps.guard);
    }
  });
}
