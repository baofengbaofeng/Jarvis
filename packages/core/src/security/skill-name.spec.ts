import { describe, expect, it } from 'vitest';
import { resolveSkillTarget, validateSkillName } from './skill-name';

describe('skill name policy', () => {
  it.each(['../escape', '..', '.', '/abs', 'a/b', 'a\\b', 'a\u2215b', 'a\u0000b', ' Upper'])(
    'rejects %j', name => expect(() => validateSkillName(name)).toThrow('SKILL_NAME_INVALID'));
  it('accepts a bounded lowercase directory name', () => {
    expect(validateSkillName('code-review.v1')).toBe('code-review.v1');
    expect(resolveSkillTarget('/home/u/.jarvis/skills', 'code-review.v1'))
      .toBe('/home/u/.jarvis/skills/code-review.v1/SKILL.md');
  });
});
