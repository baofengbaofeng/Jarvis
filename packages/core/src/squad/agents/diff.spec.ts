import { describe, it, expect } from 'vitest';
import { changedFields, diffConfigJson } from './diff';

describe('agent config diff', () => {
  it('detects changed fields', () => {
    expect(changedFields({ a: 1, b: 'x' }, { a: 2, b: 'x' })).toEqual(['a']);
  });

  it('produces a unified diff text', () => {
    const d = diffConfigJson({ name: 'A', model: 'm1' }, { name: 'A', model: 'm2' });
    expect(d).toContain('-');
    expect(d).toContain('+');
  });
});
