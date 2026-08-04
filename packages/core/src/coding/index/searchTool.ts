import type { ToolRegistry } from '../../agent/ToolRegistry';
import type { IndexStore } from './IndexStore';

export function registerSearchCodeTool(registry: ToolRegistry, index: IndexStore): void {
  registry.register({
    name: 'search_code', description: 'Semantic search over the indexed workspace code',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
  }, async (args) => {
    // Guard the limit: negative, NaN, or Infinity must not produce a wrong/empty
    // slice — fall back to the default 5. (M4 Task 6 review fix)
    const n = Number(args.limit ?? 5);
    const limit = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
    const rows = await index.search(String(args.query), limit);
    return { ok: true, output: rows.map(r => `${r.path}:${r.startLine}-${r.endLine}\n${r.text}`).join('\n---\n') };
  });
}
