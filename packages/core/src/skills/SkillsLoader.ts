import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSkillTarget, validateSkillName } from '../security/skill-name';

export interface SkillMeta { name: string; description: string; triggers: string[]; path: string }

export function parseSkillFrontmatter(fileText: string): SkillMeta {
  const m = /^---\n([\s\S]*?)\n---/.exec(fileText);
  if (!m) throw new Error('missing frontmatter');
  const fields: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const triggers = /\[([^\]]*)\]/.exec(fields.triggers ?? '[]');
  const name = validateSkillName(fields.name ?? 'unnamed');
  return {
    name,
    description: fields.description ?? '',
    triggers: triggers ? triggers[1].split(',').map(s => s.trim()).filter(Boolean) : [],
    path: ''
  };
}

export interface ReadFn { (path: string): string | null }
export interface ListDirsFn { (dir: string): string[] }

export function scanSkillsDir(skillsDir: string, readImpl: ReadFn = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } }, listImpl?: ListDirsFn): SkillMeta[] {
  const list = listImpl ?? ((d: string) => { try { return readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } });
  const out: SkillMeta[] = [];
  for (const sub of list(skillsDir)) {
    const md = `${skillsDir}/${sub}/SKILL.md`;
    const text = readImpl(md);
    if (!text) continue;
    try { out.push({ ...parseSkillFrontmatter(text), path: md }); } catch { /* skip */ }
  }
  return out;
}

export function buildSkillInjection(metas: SkillMeta[]): string {
  if (metas.length === 0) return '';
  return '\n<available-skills>\n' + metas.map(m => `- ${m.name}: ${m.description}`).join('\n') + '\n</available-skills>';
}

export interface ImportSkillDocumentOptions {
  overwrite?: boolean;
}

export function importSkillDocument(text: string, root: string, opts: ImportSkillDocumentOptions = {}): SkillMeta {
  const meta = parseSkillFrontmatter(text);
  const targetPath = resolveSkillTarget(root, meta.name);
  if (!opts.overwrite && existsSync(targetPath)) {
    throw new Error('SKILL_EXISTS');
  }
  mkdirSync(join(targetPath, '..'), { recursive: true });
  writeFileSync(targetPath, text, 'utf8');
  return { ...meta, path: targetPath };
}
