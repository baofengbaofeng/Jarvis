import type { ToolRegistry } from '../../agent/ToolRegistry';
import type { IndexStore } from './IndexStore';

export function registerSearchCodeTool(registry: ToolRegistry, index: IndexStore): void {
  registry.register({
    name: 'search_code', description: 'Semantic search over the indexed workspace code',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
  }, async (args) => {
    const rows = await index.search(String(args.query), Number(args.limit ?? 5));
    return { ok: true, output: rows.map(r => `${r.path}:${r.startLine}-${r.endLine}\n${r.text}`).join('\n---\n') };
  });
}
