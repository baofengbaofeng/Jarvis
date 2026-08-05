import { describe, it, expect } from 'vitest';
import { parseTable, extractMermaid, captureArtifacts, dataPointSeries } from './artifacts';

describe('artifacts', () => {
  it('parses markdown table', () => {
    const t = parseTable('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    expect(t.headers).toEqual(['A', 'B']);
    expect(t.rows).toEqual([['1', '2'], ['3', '4']]);
  });
  it('extracts a mermaid block', () => {
    expect(extractMermaid('before\n```mermaid\ngraph TD; A-->B\n```\nafter')).toContain('graph TD');
    expect(extractMermaid('no block here')).toBeNull();
  });
  it('captureArtifacts finds table and mermaid from result text', () => {
    const arts = captureArtifacts('t1', '| H |\n|---|\n| 9 |\n\n```mermaid\ngraph LR; A-->B\n```');
    expect(arts.map(a => a.kind)).toEqual(['table', 'mermaid']);
    // The table capture must stop at the blank line — it must not swallow the
    // following mermaid block into the table content.
    expect(arts[0].content).toBe('| H |\n|---|\n| 9 |');
  });
  it('captureArtifacts finds a table mid-text (not only at position 0)', () => {
    const arts = captureArtifacts('t1', 'intro\n\n| X |\n|---|\n| 1 |\n\ntail');
    expect(arts.map(a => a.kind)).toEqual(['table']);
    expect(arts[0].content).toBe('| X |\n|---|\n| 1 |');
  });
  it('captureArtifacts returns a markdown artifact for prose and [] for empty text', () => {
    const prose = captureArtifacts('t1', 'just some prose\nno table, no mermaid');
    expect(prose.map(a => a.kind)).toEqual(['markdown']);
    expect(prose[0].content).toBe('just some prose\nno table, no mermaid');
    expect(captureArtifacts('t1', '')).toEqual([]);
    expect(captureArtifacts('t1', '   \n  ')).toEqual([]);
  });
  it('dataPointSeries keeps label/value pairs', () => {
    expect(dataPointSeries([{ label: 'a', value: 1 }, { label: 'b', value: 2 }])).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2 }]);
  });
});
