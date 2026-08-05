import { describe, it, expect } from 'vitest';
import { classifyFile, extractFileText, extractPptxText } from './files';

describe('office files', () => {
  it('classifies by extension', () => {
    expect(classifyFile('a.pdf')).toBe('pdf');
    expect(classifyFile('b.docx')).toBe('docx');
    expect(classifyFile('c.xlsx')).toBe('xlsx');
    expect(classifyFile('d.pptx')).toBe('pptx');
    expect(classifyFile('e.png')).toBe('image');
    expect(classifyFile('f.txt')).toBe('other');
  });

  it('routes to the matching extractor', async () => {
    const extractors = { docx: async () => 'doc text' };
    expect(await extractFileText({ path: '/x/a.docx', name: 'a.docx' }, extractors)).toBe('doc text');
    await expect(extractFileText({ path: '/x/a.pdf', name: 'a.pdf' }, extractors)).rejects.toThrow('unsupported');
  });

  it('extracts text from pptx slide xml', () => {
    expect(extractPptxText('<a:t>Hello</a:t><a:t>World</a:t>')).toBe('Hello\nWorld');
  });
});
