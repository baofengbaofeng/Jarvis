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
  registry.register({
    name: 'memorize', description: 'Store a persistent memory for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
  }, async (args) => {
    store.memorize(agentId, String(args.key), String(args.value));
    return { ok: true, output: 'remembered' };
  });

  registry.register({
    name: 'recall', description: 'Recall stored memories for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' } } }
  }, async (args) => {
    const items = store.recall(agentId, args.key ? String(args.key) : undefined);
    return { ok: true, output: items.map(i => `${i.key}: ${i.value}`).join('\n') || 'no memories' };
  });
}
