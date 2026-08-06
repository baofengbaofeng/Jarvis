import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import {
  buildContextMessages,
  scanSkillsDir,
  buildSkillInjection,
  buildMemoryInjection,
  parseMentions,
  resolveFileMention,
  buildMentionBlock,
  type MemoryStore,
  type SessionStoreAdapter,
  type SessionMessage,
} from '@jarvis/core';
import type { AgentConfig } from '@jarvis/protocol';
import type { ContextAttachment } from '@jarvis/core';

// M4 Task 3 (E6): @mention parsing + context attachment injection.
function readImpl(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function attachMentions(userInput: string, wsRoot: string, db: Database.Database, agentId: string | null): { input: string; block: string } {
  const mentions = parseMentions(userInput);
  const refs: ContextAttachment[] = [];
  for (const m of mentions) {
    try {
      refs.push(resolveFileMention(m.query, wsRoot, readImpl, { resolve, relative, isAbsolute }));
    } catch (err) {
      appendAudit(db, { agentId, kind: 'mention', detail: { query: m.query, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  let input = userInput;
  for (let i = mentions.length - 1; i >= 0; i--) {
    const m = mentions[i];
    input = input.slice(0, m.index) + input.slice(m.index + m.raw.length);
  }
  return { input, block: buildMentionBlock(refs) };
}

export function buildTaskMessages(
  ctx: { jarvisMd: string; agentMd: string | null },
  agent: AgentConfig,
  prompt: string,
  workspaceRoot: string,
  db: Database.Database,
  agentId: string | null,
  memory: MemoryStore,
): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const skills = scanSkillsDir(`${workspaceRoot}/.jarvis/skills`);
  const injection = buildSkillInjection(skills);
  const memoryBlock = agentId ? buildMemoryInjection(memory.recall(agentId)) : '';
  const system = `${agent.systemPrompt}${injection}${memoryBlock}`;
  const { input, block } = attachMentions(prompt, workspaceRoot, db, agentId);
  return buildContextMessages(ctx, system, [{ role: 'user', content: `${input}${block}` }]);
}

const SUMMARY_MARKER = '[JARVIS_SUMMARY]';

export function createTaskSessionAdapter(db: Database.Database, sessionId: string): SessionStoreAdapter {
  return {
    async getMessages(): Promise<SessionMessage[]> {
      const rows = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? AND role IN (?,?) ORDER BY created_at').all(sessionId, 'user', 'assistant') as Array<{ role: 'user' | 'assistant'; content: string }>;
      return rows.filter(r => !r.content.startsWith(SUMMARY_MARKER));
    },
    async getSummary(): Promise<string | null> {
      const row = db.prepare('SELECT content FROM chat_messages WHERE session_id = ? AND role = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 1').get(sessionId, 'system', `${SUMMARY_MARKER}%`) as { content: string } | undefined;
      return row ? row.content.slice(SUMMARY_MARKER.length) : null;
    },
    async saveSummary(_taskId: string, text: string): Promise<void> {
      db.prepare('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), sessionId, 'system', `${SUMMARY_MARKER}${text}`, new Date().toISOString());
    }
  };
}

export function summarizeForNotification(text: string): string {
  const line = text.trim().split('\n').find(l => l.trim().length > 0) ?? '';
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

export function appendAudit(db: Database.Database, e: { agentId: string | null; kind: string; detail: unknown }): void {
  const d = (e.detail ?? {}) as { toolName?: string; ok?: boolean; reason?: string; query?: string };
  const action = d.toolName ?? e.kind;
  const target = d.query ?? null;
  const result = e.kind === 'mention' ? 'error' : (d.ok === false || d.reason ? 'denied' : 'ok');
  db.prepare('INSERT INTO audit_logs (kind, actor, action, target, result, detail) VALUES (?,?,?,?,?,?)')
    .run(e.kind, e.agentId, action, target, result, JSON.stringify(e.detail));
}
