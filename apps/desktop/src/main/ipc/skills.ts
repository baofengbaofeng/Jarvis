import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { scanSkillsDir, type SkillMeta } from '@jarvis/core';

export function createSkillsStore(db: Database.Database) {
  return {
    list() {
      return (db.prepare('SELECT * FROM skills ORDER BY created_at').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string, name: r.name as string, path: r.path as string, description: r.description as string
      }));
    },
    importFromDir(dir: string): SkillMeta[] {
      const metas = scanSkillsDir(dir);
      for (const m of metas) {
        db.prepare('INSERT INTO skills (id, name, path, description, created_at) VALUES (?,?,?,?,?)')
          .run(randomUUID(), m.name, m.path, m.description, new Date().toISOString());
      }
      return metas;
    },
    remove(id: string) { db.prepare('DELETE FROM skills WHERE id = ?').run(id); }
  };
}
