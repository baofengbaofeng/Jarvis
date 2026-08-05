import { describe, it, expect } from 'vitest';
import { DEFAULT_WIPE_TABLES, confirmPhrase, type WipeScope } from './Wipe';

describe('Wipe', () => {
  it('covers chat, audit, usage, task and message tables', () => {
    for (const t of ['chat_sessions', 'chat_messages', 'audit_logs', 'token_usage', 'tasks', 'agent_messages', 'agent_call_edges']) {
      expect(DEFAULT_WIPE_TABLES).toContain(t);
    }
    expect(DEFAULT_WIPE_TABLES).not.toContain('providers');
  });
  it('confirmPhrase requires typing DELETE ALL for keychain scope', () => {
    const scope: WipeScope = { tables: DEFAULT_WIPE_TABLES, keychain: true, workspace: false };
    expect(confirmPhrase(scope)).toBe('DELETE ALL');
  });
  it('confirmPhrase requires DELETE when keychain is not included', () => {
    const scope: WipeScope = { tables: ['chat_messages'], keychain: false, workspace: false };
    expect(confirmPhrase(scope)).toBe('DELETE');
  });
});
