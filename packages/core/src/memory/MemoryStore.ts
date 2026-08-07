import type { ToolRegistry } from '../agent/ToolRegistry';

export interface MemoryEntry { id: string; agentId: string; key: string; value: string; updatedAt: string }
export interface MemoryAdapter {
  upsert(agentId: string, key: string, value: string): void;
  get(agentId: string, key: string): MemoryEntry | null;
  list(agentId: string): MemoryEntry[];
  remove(agentId: string, key: string): void;
}

export class MemoryStore {
  // The adapter owns the updated_at timestamp (upsert stamps it), so the store
  // has no clock of its own — the brief's `now` constructor param was dead code
  // that tripped noUnusedParameters and was removed (see task-7 report).
  constructor(private adapter: MemoryAdapter) {}

  memorize(agentId: string, key: string, value: string): MemoryEntry {
    this.adapter.upsert(agentId, key, value);
    return this.adapter.get(agentId, key)!;
  }

  recall(agentId: string, key?: string): MemoryEntry[] {
    if (key) { const e = this.adapter.get(agentId, key); return e ? [e] : []; }
    return this.adapter.list(agentId);
  }

  forget(agentId: string, key: string): void {
    this.adapter.remove(agentId, key);
  }
}

export function buildMemoryInjection(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  return '\n<memory>\n' + entries.map(e => `${e.key}: ${e.value}`).join('\n') + '\n</memory>';
}

export function registerMemoryTools(registry: ToolRegistry, store: MemoryStore, agentId: string): void {
  // M6 final review (finding 3): the engine is SHARED across tasks/squad
  // members, so the baked agentId here is only a fallback. The run's agent
  // (ctx.agent, threaded through AgentEngine.run) wins when present — a leader
  // run then a member run on the same registry each memorize to their own
  // memory, not to the last-registered agent.
  // CORE-07: tools are registered once; re-entry is a no-op (ctx.agent scopes).
  if (registry.has('memorize') || registry.has('recall')) return;
  const resolveAgent = (ctx: { agent?: { id: string } }): string => ctx.agent?.id ?? agentId;
  registry.register({
    name: 'memorize', description: 'Store a persistent memory for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
  }, async (args, ctx) => {
    store.memorize(resolveAgent(ctx), String(args.key), String(args.value));
    return { ok: true, output: 'remembered' };
  });

  registry.register({
    name: 'recall', description: 'Recall stored memories for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' } } }
  }, async (args, ctx) => {
    const items = store.recall(resolveAgent(ctx), args.key ? String(args.key) : undefined);
    return { ok: true, output: items.map(i => `${i.key}: ${i.value}`).join('\n') || 'no memories' };
  });
}
