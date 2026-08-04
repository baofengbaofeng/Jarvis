import { describe, it, expect } from 'vitest';
import { buildContextMessages, mergeEnv } from './context';

describe('agent context', () => {
  it('merges env with precedence system < dotenv < agent < multica', () => {
    const merged = mergeEnv({ A: '1', S: 'sys' }, { A: '2' }, { A: '3', B: 'b' }, { A: '4' });
    expect(merged.A).toBe('4');
    expect(merged.B).toBe('b');
    expect(merged.S).toBe('sys');
  });

  it('builds system message with jarvis context', () => {
    const msgs = buildContextMessages({ jarvisMd: '# rules', agentMd: '# agent' }, 'be helpful', [{ role: 'user', content: 'hi' }]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('# rules');
    expect(msgs[0].content).toContain('be helpful');
  });
});
