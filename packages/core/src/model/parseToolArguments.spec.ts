import { describe, it, expect } from 'vitest';
import { parseToolArguments } from './parseToolArguments';

describe('parseToolArguments (CORE-03)', () => {
  it('parses a well-formed object', () => {
    expect(parseToolArguments('{"city":"SF"}')).toEqual({ ok: true, value: { city: 'SF' } });
  });

  it('treats empty / whitespace input as {}', () => {
    expect(parseToolArguments('')).toEqual({ ok: true, value: {} });
    expect(parseToolArguments('   ')).toEqual({ ok: true, value: {} });
  });

  it('rejects truncated JSON instead of collapsing to {}', () => {
    const r = parseToolArguments('{"city":"SF"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('rejects non-object JSON', () => {
    expect(parseToolArguments('"just a string"').ok).toBe(false);
    expect(parseToolArguments('42').ok).toBe(false);
    expect(parseToolArguments('[1,2]').ok).toBe(false);
    expect(parseToolArguments('null').ok).toBe(false);
  });
});
