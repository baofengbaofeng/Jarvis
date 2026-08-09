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
import { SKILL_FIELD_MAX, type AgentConfig } from '@jarvis/protocol';

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

function asEnabled(value: unknown): boolean {
  return Number(value ?? 1) === 1;
}

export function assertSkillImportUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('SKILL_URL_REQUIRED');
  if (trimmed.length > SKILL_FIELD_MAX.url) throw new Error('SKILL_URL_TOO_LONG');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('SKILL_URL_PROTOCOL');
  return trimmed;
}

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
        id: r.id as string,
        name: r.name as string,
        path: r.path as string,
        description: r.description as string,
        enabled: asEnabled(r.enabled),
      }));
    },
    listEnabled() {
      return this.list().filter((s) => s.enabled);
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
      const safeUrl = assertSkillImportUrl(url);
      const res = await http.request(safeUrl, { method: 'GET' }, SKILL_FETCH_LIMITS);
      if (!res.ok) throw new Error(`SKILL_HTTP_${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'text/markdown' && contentType !== 'text/plain') {
        throw new Error('SKILL_CONTENT_TYPE');
      }
      const text = await res.text();
      return persistSkill(importSkillDocument(text, root));
    },
    setEnabled(id: string, enabled: boolean) {
      const cur = db.prepare('SELECT id FROM skills WHERE id = ?').get(id);
      if (!cur) throw new Error('SKILL_NOT_FOUND');
      db.prepare('UPDATE skills SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      return this.list().find((s) => s.id === id)!;
    },
    remove(id: string) { db.prepare('DELETE FROM skills WHERE id = ?').run(id); }
  };
}
