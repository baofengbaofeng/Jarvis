import { describe, it, expect } from 'vitest';
import { chatText } from './officeChat';

// Complementary coverage to selection.spec.ts: chatText must treat absent
// deltaText as an empty segment (not "undefined") and trim the assembled
// transcript, since the office IPC returns chatText() straight to the renderer.
describe('chatText edge cases', () => {
  it('skips undefined deltas and trims the result', async () => {
    async function* fake(): AsyncIterable<{ deltaText?: string }> {
      yield { deltaText: '  ' };
      yield {}; // no deltaText -> ignored, not "undefined"
      yield { deltaText: 'ok' };
    }
    expect(await chatText({ chat: async () => fake() } as never, [{ role: 'user', content: 'hi' }])).toBe('ok');
  });
});
