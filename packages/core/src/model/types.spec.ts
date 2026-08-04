import { describe, it, expect } from 'vitest';
import { isDoneChunk } from './types';

describe('model types', () => {
  it('recognizes done chunk', () => {
    expect(isDoneChunk({ kind: 'done' })).toBe(true);
    expect(isDoneChunk({ kind: 'delta', delta: 'x' })).toBe(false);
  });
  it('adapter factory returns adapter for both types', async () => {
    const { createAdapter } = await import('./adapters/index');
    expect(createAdapter('openai-compatible').type).toBe('openai-compatible');
    expect(createAdapter('anthropic-compatible').type).toBe('anthropic-compatible');
  });
});
