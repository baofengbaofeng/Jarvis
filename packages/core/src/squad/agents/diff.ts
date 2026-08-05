import { diffLines, groupHunks, toUnified } from '../../coding/diff';

export function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function diffConfigJson(a: Record<string, unknown>, b: Record<string, unknown>): string {
  const hunks = groupHunks(diffLines(JSON.stringify(a, null, 2).split('\n'), JSON.stringify(b, null, 2).split('\n')));
  return hunks.length ? toUnified(hunks) : '(no changes)';
}
