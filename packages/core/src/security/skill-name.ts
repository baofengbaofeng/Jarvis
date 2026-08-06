import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SLASH_LIKE = /[/\\\u2215\u2216\uff0f\u2044]/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function validateSkillName(name: string): string {
  if (name === '.' || name === '..' || CONTROL_CHARS.test(name) || SLASH_LIKE.test(name) || !SKILL_NAME_RE.test(name)) {
    throw new Error('SKILL_NAME_INVALID');
  }
  return name;
}

export function resolveSkillTarget(root: string, name: string): string {
  const safe = validateSkillName(name);
  const base = resolve(root);
  const targetDir = resolve(base, safe);
  const rel = relative(base, targetDir);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('SKILL_PATH_ESCAPE');
  return join(targetDir, 'SKILL.md');
}
