import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  return {
    name: fields.name ?? 'unnamed',
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

export async function importSkillFromUrl(url: string, destDir: string, deps: { fetchImpl?: typeof fetch } = {}): Promise<SkillMeta> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`import skill http ${res.status}`);
  const text = await res.text();
  const meta = { ...parseSkillFrontmatter(text), path: join(destDir, 'SKILL.md') };
  writeFileSync(meta.path, text, 'utf8');
  return meta;
}
