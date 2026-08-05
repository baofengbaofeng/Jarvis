import { describe, it, expect } from 'vitest';
import { buildSelectionPrompt } from './selection';
import { chatText } from './officeChat';

describe('selection prompts', () => {
  it('builds per-action prompts', () => {
    expect(buildSelectionPrompt({ text: 'hello world', action: 'translate', targetLang: '中文' })).toContain('中文');
    expect(buildSelectionPrompt({ text: 'x', action: 'summarize' })).toContain('要点');
    expect(buildSelectionPrompt({ text: 'x', action: 'search' })).toContain('搜索词');
  });
});

describe('chatText', () => {
  it('collects streaming deltas', async () => {
    async function* fake(): AsyncIterable<{ deltaText?: string }> { yield { deltaText: 'a' }; yield { deltaText: 'b' }; }
    expect(await chatText({ chat: async () => fake() } as never, [{ role: 'user', content: 'hi' }])).toBe('ab');
  });
});
