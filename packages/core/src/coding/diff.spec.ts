import { describe, it, expect } from 'vitest';
import { diffLines, groupHunks, toUnified, parseUnified, applyHunks } from './diff';

const a = ['const x = 1;', 'export function add(a, b) {', '  return a + b;', '}'];
const b = ['const x = 2;', 'export function add(a, b) {', '  return a + b;', '  // new', '}'];

describe('diff engine', () => {
  it('produces add/del/context lines', () => {
    const d = diffLines(a, b);
    expect(d.some(l => l.type === 'del' && l.text === 'const x = 1;')).toBe(true);
    expect(d.some(l => l.type === 'add' && l.text === 'const x = 2;')).toBe(true);
  });

  it('groups hunks and roundtrips through unified text', () => {
    const hunks = groupHunks(diffLines(a, b));
    const reparsed = parseUnified(toUnified(hunks));
    expect(reparsed.length).toBe(hunks.length);
    expect(reparsed[0].oldStart).toBe(1);
    expect(reparsed[0].lines.filter(l => l.type === 'add').length).toBe(1);
  });

  it('applies accepted hunks to reach the target file', () => {
    const hunks = groupHunks(diffLines(a, b));
    const accepts = hunks.map(() => true);
    expect(applyHunks(a, hunks, accepts).join('\n')).toBe(b.join('\n'));
  });

  it('keeps original when all hunks rejected', () => {
    const hunks = groupHunks(diffLines(a, b));
    const rejects = hunks.map(() => false);
    expect(applyHunks(a, hunks, rejects).join('\n')).toBe(a.join('\n'));
  });
});
