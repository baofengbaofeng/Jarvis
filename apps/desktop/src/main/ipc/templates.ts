import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// D15 prompt template library store. M0 schema v1 defines the table as
// `prompt_templates (id, name, content, created_at)` — note the body column is
// `content`, NOT the `text` the brief sketched, so every query here reads/writes
// `content`. The store is main-owned (per §13.3); the renderer only talks to it
// through the templates.* IPC channels.
export interface PromptTemplateRow { id: string; name: string; content: string }

export function createTemplatesStore(db: Database.Database) {
  const list = (): PromptTemplateRow[] =>
    (db.prepare('SELECT id, name, content FROM prompt_templates ORDER BY created_at').all() as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string, name: r.name as string, content: r.content as string
    }));
  return {
    list,
    create(input: { name: string; content: string }): PromptTemplateRow {
      const id = randomUUID();
      db.prepare('INSERT INTO prompt_templates (id, name, content, created_at) VALUES (?,?,?,?)')
        .run(id, input.name, input.content, new Date().toISOString());
      // Return the row we just wrote rather than list().at(-1): two templates
      // created in the same millisecond tie on ORDER BY created_at, and the
      // "last" row could resolve to the wrong one.
      return { id, name: input.name, content: input.content };
    },
    update(id: string, input: { name?: string; content?: string }): void {
      const cur = list().find(t => t.id === id);
      if (!cur) throw new Error(`template ${id} not found`);
      db.prepare('UPDATE prompt_templates SET name = ?, content = ? WHERE id = ?')
        .run(input.name ?? cur.name, input.content ?? cur.content, id);
    },
    remove(id: string): void {
      db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
    }
  };
}
