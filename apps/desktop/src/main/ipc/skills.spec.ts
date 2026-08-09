import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../db/migrations';
import { assertSkillImportUrl, createSkillsStore } from './skills';

describe('createSkillsStore', () => {
  let db: Database.Database;
  let root: string;
  const agents = { list: () => [] as import('@jarvis/protocol').AgentConfig[] };

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    root = mkdtempSync(join(tmpdir(), 'jarvis-skills-store-'));
  });

  it('rejects invalid skill import URLs before fetching', () => {
    expect(() => assertSkillImportUrl('')).toThrow('SKILL_URL_REQUIRED');
    expect(() => assertSkillImportUrl('ftp://x')).toThrow('SKILL_URL_PROTOCOL');
    expect(() => assertSkillImportUrl(`https://x/${'p'.repeat(2048)}`)).toThrow('SKILL_URL_TOO_LONG');
  });

  it('toggles enabled on listed skills', async () => {
    const http = {
      request: vi.fn(async () => new Response(
        '---\nname: web-import\ndescription: d\ntriggers: []\n---\nbody',
        { status: 200, headers: { 'content-type': 'text/markdown' } },
      )),
    };
    const store = createSkillsStore(db, agents, { root, http });
    await store.importFromUrl('https://skills.example/SKILL.md');
    const listed = store.list();
    expect(listed[0]?.enabled).toBe(true);
    store.setEnabled(listed[0]!.id, false);
    expect(store.list()[0]?.enabled).toBe(false);
    expect(store.listEnabled()).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it('downloads through SafeHttpClient and writes under the managed root', async () => {
    const http = {
      request: vi.fn(async () => new Response(
        '---\nname: web-import\ndescription: d\ntriggers: []\n---\nbody',
        { status: 200, headers: { 'content-type': 'text/markdown' } },
      )),
    };
    const store = createSkillsStore(db, agents, { root, http });
    const result = await store.importFromUrl('https://skills.example/SKILL.md');
    expect(http.request).toHaveBeenCalledWith(
      'https://skills.example/SKILL.md',
      expect.anything(),
      expect.objectContaining({ maxResponseBytes: 262144 }),
    );
    expect(result.path).toBe(join(root, 'web-import', 'SKILL.md'));
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects non-markdown content before writing', async () => {
    const store = createSkillsStore(db, agents, {
      root,
      http: { request: async () => new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } }) },
    });
    await expect(store.importFromUrl('https://skills.example/x')).rejects.toThrow('SKILL_CONTENT_TYPE');
    rmSync(root, { recursive: true, force: true });
  });
});
