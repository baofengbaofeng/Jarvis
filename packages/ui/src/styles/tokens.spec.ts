import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'tokens.css'), 'utf8');

describe('tokens.css', () => {
  it('defines light and dark surfaces and Apple-blue accent', () => {
    expect(css).toMatch(/\[data-theme=['"]light['"]\]|:root/);
    expect(css).toMatch(/\[data-theme=['"]dark['"]\]/);
    for (const v of ['--bg', '--surface', '--surface-raised', '--border', '--border-subtle',
      '--fg', '--fg-muted', '--fg-faint', '--accent', '--accent-fg',
      '--success', '--warning', '--danger', '--info',
      '--space-1', '--radius-md', '--text-sm', '--font-sans', '--font-mono']) {
      expect(css).toContain(v);
    }
    expect(css).toMatch(/--accent:\s*#007aff/i);
    expect(css).not.toMatch(/#7c3aed|#8b5cf6|purple/i);
  });
});
