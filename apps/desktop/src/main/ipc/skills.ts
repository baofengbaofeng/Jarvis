import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scanSkillsDir, type SkillMeta } from '@jarvis/core';
import type { AgentConfig } from '@jarvis/protocol';

export interface SkillsAgentSource { list(): AgentConfig[] }

export function createSkillsStore(db: Database.Database, agents: SkillsAgentSource = { list: () => [] }) {
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
        this.copyToBoundWorkspaces(m);
      }
      return metas;
    },
    // M3 final review (J2): skills.import used to write DB rows only, but the
    // runtime system-prompt injection reads from the FILESYSTEM
    // (scanSkillsDir(`${workspaceRoot}/.jarvis/skills`)), so an imported skill
    // had no runtime effect. Copy each SKILL.md into every bound workspace's
    // .jarvis/skills/{name}/ so the next task run injects it.
    copyToBoundWorkspaces(m: SkillMeta): void {
      const workspaces = [...new Set(agents.list().map(a => a.workspaceId).filter((w): w is string => Boolean(w)))];
      for (const ws of workspaces) {
        const dest = join(ws, '.jarvis', 'skills', m.name, 'SKILL.md');
        try {
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(m.path, dest);
        } catch (e) {
          console.error(`skills: failed to copy ${m.path} -> ${dest}`, e);
        }
      }
    },
    remove(id: string) { db.prepare('DELETE FROM skills WHERE id = ?').run(id); }
  };
}
