export interface Mention { raw: string; query: string }
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
  while ((m = re.exec(text))) out.push({ raw: m[0].trim(), query: m[1] });
  return out;
}

export function resolveFileMention(query: string, workspaceRoot: string, readImpl: (p: string) => string | null): ContextAttachment {
  const path = `${workspaceRoot}/${query}`;
  const content = readImpl(path);
  if (content === null) throw new MentionError(`not found: ${query}`);
  return { type: 'file', source: query, content };
}

export function buildMentionBlock(attachments: ContextAttachment[]): string {
  if (attachments.length === 0) return '';
  return '\n<referenced>\n' + attachments.map(a => `[${a.type}] ${a.source}\n${a.content}`).join('\n---\n') + '\n</referenced>';
}
