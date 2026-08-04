import { resolve, relative, isAbsolute } from 'node:path';

export interface Mention { raw: string; query: string; index: number }
export type MentionKind = 'file' | 'folder' | 'symbol' | 'doc' | 'agent';
export interface MentionCandidate { id: string; label: string; kind: MentionKind; path?: string }
export interface ContextAttachment { type: MentionKind | 'text'; source: string; content: string }
export interface MentionResolver {
  search(query: string): Promise<MentionCandidate[]>;
  resolve(candidate: MentionCandidate): Promise<ContextAttachment>;
}

export class MentionError extends Error {}

export function parseMentions(text: string): Mention[] {
  const out: Mention[] = [];
  const re = /(?:^|\s)@([^\s@#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim();
    // index is the position of the '@' in the original text, so callers can
    // strip exactly the parsed raw token range (not a fresh unanchored match).
    out.push({ raw, query: m[1], index: m.index + (m[0].length - raw.length) });
  }
  return out;
}

export function resolveFileMention(query: string, workspaceRoot: string, readImpl: (p: string) => string | null): ContextAttachment {
  // Containment check before any fs read: normalize the workspace root and the
  // resolved target, then reject anything that escapes the root (e.g.
  // `@../../etc/passwd`). Same pattern as Sandbox.ts.
  const root = resolve(workspaceRoot);
  const resolved = resolve(root, query);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new MentionError(`outside workspace: ${query}`);
  const content = readImpl(resolved);
  if (content === null) throw new MentionError(`not found: ${query}`);
  return { type: 'file', source: query, content };
}

export function buildMentionBlock(attachments: ContextAttachment[]): string {
  if (attachments.length === 0) return '';
  return '\n<referenced>\n' + attachments.map(a => `[${a.type}] ${a.source}\n${a.content}`).join('\n---\n') + '\n</referenced>';
}
