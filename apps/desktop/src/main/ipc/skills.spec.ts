import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../db/migrations';
import { createSkillsStore } from './skills';

describe('createSkillsStore', () => {
  let db: Database.Database;
  let root: string;
  const agents = { list: () => [] as Array<{ workspaceId?: string | null }> };

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    root = mkdtempSync(join(tmpdir(), 'jarvis-skills-store-'));
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
