import { describe, expect, it } from 'vitest';
import { isSecretRef, mapSecretPlainRecord, secretRefKey } from './secrets';

describe('secret refs', () => {
  it('detects secretRef objects', () => {
    expect(isSecretRef({ secretRef: 'mcp.1.env.TOK' })).toBe(true);
    expect(isSecretRef('plain')).toBe(false);
    expect(isSecretRef({ secretRef: '  ' })).toBe(false);
  });

  it('returns the ref key', () => {
    expect(secretRefKey({ secretRef: ' mcp.x ' })).toBe('mcp.x');
    expect(secretRefKey('x')).toBeUndefined();
  });

  it('resolves mixed plain/secret maps', () => {
    const out = mapSecretPlainRecord(
      {
        A: 'plain',
        B: { secretRef: 'ref.b' },
        C: { secretRef: 'missing' },
      },
      (ref) => (ref === 'ref.b' ? 'secret-b' : undefined),
    );
    expect(out).toEqual({ A: 'plain', B: 'secret-b' });
  });
});
