import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  importSkillDocument,
  scanSkillsDir,
  type SafeHttpClient,
  type SkillMeta,
} from '@jarvis/core';
import type { AgentConfig } from '@jarvis/protocol';

export interface SkillsAgentSource { list(): AgentConfig[] }

export interface SkillsStoreDeps {
  root: string;
  http: SafeHttpClient;
}

const SKILL_FETCH_LIMITS = {
  timeoutMs: 15_000,
  maxRedirects: 3,
  maxResponseBytes: 262144,
};

export function createSkillsStore(
  db: Database.Database,
  agents: SkillsAgentSource = { list: () => [] },
  deps: SkillsStoreDeps,
) {
  const { root, http } = deps;
  mkdirSync(root, { recursive: true });

  const copyToBoundWorkspaces = (m: SkillMeta): void => {
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
  };

  const persistSkill = (meta: SkillMeta): SkillMeta => {
    try {
      db.prepare('INSERT INTO skills (id, name, path, description, created_at) VALUES (?,?,?,?,?)')
        .run(randomUUID(), meta.name, meta.path, meta.description, new Date().toISOString());
    } catch (e) {
      try { unlinkSync(meta.path); } catch { /* ignore */ }
      throw e;
    }
    copyToBoundWorkspaces(meta);
    return meta;
  };

  return {
    list() {
      return (db.prepare('SELECT * FROM skills ORDER BY created_at').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string, name: r.name as string, path: r.path as string, description: r.description as string
      }));
    },
    importFromDir(dir: string): SkillMeta[] {
      const metas = scanSkillsDir(dir);
      const out: SkillMeta[] = [];
      // Batch import is best-effort: skills persisted before a later failure remain
      // on disk and in DB (brief requires rollback only for single URL import).
      for (const m of metas) {
        const text = readFileSync(m.path, 'utf8');
        out.push(persistSkill(importSkillDocument(text, root)));
      }
      return out;
    },
    async importFromUrl(url: string): Promise<SkillMeta> {
      const res = await http.request(url, { method: 'GET' }, SKILL_FETCH_LIMITS);
      if (!res.ok) throw new Error(`SKILL_HTTP_${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'text/markdown' && contentType !== 'text/plain') {
        throw new Error('SKILL_CONTENT_TYPE');
      }
      const text = await res.text();
      return persistSkill(importSkillDocument(text, root));
    },
    remove(id: string) { db.prepare('DELETE FROM skills WHERE id = ?').run(id); }
  };
}
