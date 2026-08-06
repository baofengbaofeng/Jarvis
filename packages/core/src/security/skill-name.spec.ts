import { describe, expect, it } from 'vitest';
import { join, parse, sep } from 'node:path';
import { assertSkillRelativePath, resolveSkillTarget, validateSkillName } from './skill-name';

describe('skill name policy', () => {
  it.each(['../escape', '..', '.', '/abs', 'a/b', 'a\\b', 'a\u2215b', 'a\u0000b', ' Upper'])(
    'rejects %j', name => expect(() => validateSkillName(name)).toThrow('SKILL_NAME_INVALID'));
  it('accepts a bounded lowercase directory name', () => {
    expect(validateSkillName('code-review.v1')).toBe('code-review.v1');
    expect(resolveSkillTarget('/home/u/.jarvis/skills', 'code-review.v1'))
      .toBe('/home/u/.jarvis/skills/code-review.v1/SKILL.md');
  });

  describe('assertSkillRelativePath', () => {
    it('throws SKILL_PATH_ESCAPE when relative is empty', () => {
      expect(() => assertSkillRelativePath('')).toThrow('SKILL_PATH_ESCAPE');
    });

    it('throws SKILL_PATH_ESCAPE when relative is parent', () => {
      expect(() => assertSkillRelativePath('..')).toThrow('SKILL_PATH_ESCAPE');
    });

    it('throws SKILL_PATH_ESCAPE when relative escapes via parent prefix', () => {
      expect(() => assertSkillRelativePath(`..${sep}outside`)).toThrow('SKILL_PATH_ESCAPE');
    });

    it('throws SKILL_PATH_ESCAPE when relative is absolute', () => {
      const absRel = join(parse(process.cwd()).root, 'outside');
      expect(() => assertSkillRelativePath(absRel)).toThrow('SKILL_PATH_ESCAPE');
    });
  });
});
