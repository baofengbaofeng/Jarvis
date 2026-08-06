import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter, scanSkillsDir, importSkillFromUrl, importSkillDocument } from './SkillsLoader';

describe('SkillsLoader', () => {
  it('parses frontmatter', () => {
    const text = `---\nname: code-review\ndescription: 审查代码\ntriggers: [review, 审查]\n---\n步骤说明...`;
    const meta = parseSkillFrontmatter(text);
    expect(meta.name).toBe('code-review');
    expect(meta.description).toBe('审查代码');
    expect(meta.triggers).toEqual(['review', '审查']);
  });

  it('scans skill directories', () => {
    const files = new Map<string, string>([
      ['/ws/.jarvis/skills/code-review/SKILL.md', '---\nname: code-review\ndescription: d\ntriggers: []\n---\nbody'],
      ['/ws/.jarvis/skills/ignore/other.md', '']
    ]);
    const metas = scanSkillsDir('/ws/.jarvis/skills', (p) => files.get(p) ?? null, (dir) => Array.from(new Set([...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length + 1).split('/')[0]))));
    expect(metas.map(m => m.name)).toContain('code-review');
  });

  it('imports a SKILL.md from url into destDir', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'jarvis-skill-'));
    try {
      const meta = await importSkillFromUrl('https://example.com/SKILL.md', dest, {
        fetchImpl: async () => ({ ok: true, text: async () => `---\nname: web-import\ndescription: 从 URL 导入\ntriggers: [import]\n---\nbody` }) as Response
      });
      expect(meta.name).toBe('web-import');
      expect(meta.path).toBe(join(dest, 'web-import', 'SKILL.md'));
      expect(readFileSync(meta.path, 'utf8')).toContain('name: web-import');
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing imported skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-skills-'));
    mkdirSync(join(root, 'safe'), { recursive: true });
    writeFileSync(join(root, 'safe', 'SKILL.md'), 'original');
    expect(() => importSkillDocument('---\nname: safe\ndescription: x\ntriggers: []\n---\nnew', root))
      .toThrow('SKILL_EXISTS');
    expect(readFileSync(join(root, 'safe', 'SKILL.md'), 'utf8')).toBe('original');
    rmSync(root, { recursive: true, force: true });
  });

  it('throws when url fetch fails', async () => {
    await expect(importSkillFromUrl('https://down.example.com/SKILL.md', '/tmp', {
      fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) as Response
    })).rejects.toThrow('import skill');
  });
});
