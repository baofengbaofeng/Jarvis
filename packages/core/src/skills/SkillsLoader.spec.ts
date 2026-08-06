import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter, scanSkillsDir, importSkillDocument } from './SkillsLoader';

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

  it('does not overwrite an existing imported skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-skills-'));
    mkdirSync(join(root, 'safe'), { recursive: true });
    writeFileSync(join(root, 'safe', 'SKILL.md'), 'original');
    expect(() => importSkillDocument('---\nname: safe\ndescription: x\ntriggers: []\n---\nnew', root))
      .toThrow('SKILL_EXISTS');
    expect(readFileSync(join(root, 'safe', 'SKILL.md'), 'utf8')).toBe('original');
    rmSync(root, { recursive: true, force: true });
  });
});
