import { describe, it, expect } from 'vitest';
import { buildWritingPrompt, splitParagraphs, translateWhileTyping } from './writing';

describe('writing', () => {
  it('builds prompts per action', () => {
    expect(buildWritingPrompt('polish', 'hi', )).toContain('润色');
    expect(buildWritingPrompt('translate', 'hi', 'en')).toContain('en');
  });

  it('splits paragraphs on blank lines', () => {
    expect(splitParagraphs('a\n\nb\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('translates complete paragraphs, leaves last pending', async () => {
    const tr = async (p: string) => `T:${p}`;
    const r = await translateWhileTyping('a\n\nb\n\nc', 'en', tr);
    expect(r.done).toEqual(['T:a', 'T:b']);
    expect(r.pending).toBe('c');
  });
});
