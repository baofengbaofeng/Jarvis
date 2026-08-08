import { describe, it, expect } from 'vitest';
import { getResources } from './index';

function flatten(o: Record<string, unknown>, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatten(v as Record<string, unknown>, `${p}${k}.`)
      : [`${p}${k}`]
  );
}

describe('i18n resources', () => {
  it('zh-CN and en key sets are symmetric', () => {
    const res = getResources();
    const zh = flatten(res['zh-CN'].common);
    const en = flatten(res.en.common);
    expect([...zh].sort()).toEqual([...en].sort());
  });
  it('contains minimum keys', () => {
    const res = getResources();
    expect(res['zh-CN'].common.app.title).toBe('J.A.R.V.I.S');
    expect(res.en.common.app.title).toBe('J.A.R.V.I.S');
    expect(res['zh-CN'].common.settings.title).toBeTruthy();
  });
});
