import { describe, it, expect } from 'vitest';
import { buildPassedContext } from './ContextStrategy';

describe('context strategies', () => {
  it('passes full result', async () => {
    expect(await buildPassedContext('full', 'whole text')).toBe('whole text');
  });

  it('summarizes or truncates', async () => {
    expect(await buildPassedContext('summary', 'long text', { summarize: async s => `SUM:${s}` })).toBe('SUM:long text');
    expect((await buildPassedContext('summary', 'x'.repeat(5000))).length).toBeLessThanOrEqual(2000);
  });

  it('extracts conclusion lines only', async () => {
    const result = '背景...\n结论:方案 A\n细节...\n总结:可行';
    const c = await buildPassedContext('conclusion', result);
    expect(c).toContain('方案 A');
    expect(c).toContain('可行');
    expect(c).not.toContain('背景');
  });

  it('renders a custom template', async () => {
    const c = await buildPassedContext('custom', 'RES', { template: '结果:{{result}} 来源:{{src}}', vars: { src: 'm1' } });
    expect(c).toBe('结果:RES 来源:m1');
  });
});
