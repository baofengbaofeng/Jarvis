import { describe, it, expect } from 'vitest';
import { decideDrop } from './dropzone';

describe('dropzone', () => {
  it('attaches images/docs and copies other files to workspace', () => {
    const d = decideDrop([{ name: 'a.png', path: '/a.png' }, { name: 'b.docx', path: '/b.docx' }, { name: 'notes.txt', path: '/notes.txt' }]);
    expect(d.attach.map(f => f.name)).toEqual(['a.png', 'b.docx']);
    expect(d.copyToWorkspace.map(f => f.name)).toEqual(['notes.txt']);
  });
});
