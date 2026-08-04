export interface Mention { raw: string; query: string; index: number }
export type MentionKind = 'file' | 'folder' | 'symbol' | 'doc' | 'agent';
export interface MentionCandidate { id: string; label: string; kind: MentionKind; path?: string }
export interface ContextAttachment { type: MentionKind | 'text'; source: string; content: string }
export interface MentionResolver {
  search(query: string): Promise<MentionCandidate[]>;
  resolve(candidate: MentionCandidate): Promise<ContextAttachment>;
}

export class MentionError extends Error {}

// Path operations needed for the workspace-containment check. Callers in the
// Electron main process inject `node:path` for full platform correctness; the
// pure default below keeps this module free of `node:*` imports so the renderer
// can bundle it (DiffPanel value-imports `{ diffLines, groupHunks }` from the
// `@jarvis/core` barrel, which re-exports this module into the browser graph).
export interface PathOps {
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): boolean;
}

function normalizeSegments(p: string): string[] {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out;
}

const posixLike: PathOps = {
  resolve(...paths) {
    // Join first, then normalize the combined path, so a `..` in a later part
    // pops segments contributed by earlier parts (e.g. `/ws` + `../../etc/passwd`).
    return '/' + normalizeSegments(paths.join('/')).join('/');
  },
  relative(from, to) {
    const a = normalizeSegments(from);
    const b = normalizeSegments(to);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const ups = Array.from({ length: a.length - i }, () => '..');
    return ups.concat(b.slice(i)).join('/') || '.';
  },
  isAbsolute(p) {
    return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
  },
};

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

export function resolveFileMention(
  query: string,
  workspaceRoot: string,
  readImpl: (p: string) => string | null,
  pathImpl: PathOps = posixLike,
): ContextAttachment {
  // Containment check before any fs read: normalize the workspace root and the
  // resolved target, then reject anything that escapes the root (e.g.
  // `@../../etc/passwd`). Same pattern as Sandbox.ts.
  const root = pathImpl.resolve(workspaceRoot);
  const resolved = pathImpl.resolve(root, query);
  const rel = pathImpl.relative(root, resolved);
  if (rel.startsWith('..') || pathImpl.isAbsolute(rel)) throw new MentionError(`outside workspace: ${query}`);
  const content = readImpl(resolved);
  if (content === null) throw new MentionError(`not found: ${query}`);
  return { type: 'file', source: query, content };
}

export function buildMentionBlock(attachments: ContextAttachment[]): string {
  if (attachments.length === 0) return '';
  return '\n<referenced>\n' + attachments.map(a => `[${a.type}] ${a.source}\n${a.content}`).join('\n---\n') + '\n</referenced>';
}
