import { describe, it, expect } from 'vitest';
import { parseIgnorePatterns, isIgnored } from './ignore';
import { Sandbox } from './Sandbox';

describe('ignore matcher', () => {
  it('matches node_modules and *.log', () => {
    const rx = parseIgnorePatterns(['node_modules/', '*.log', '# comment', '!keep.log']);
    expect(isIgnored('/w/node_modules/x.js', rx)).toBe(true);
    expect(isIgnored('/w/a.log', rx)).toBe(true);
    expect(isIgnored('/w/a.txt', rx)).toBe(false);
  });
});

describe('Sandbox', () => {
  const policy = { level: 'readwrite' as const, allowDomains: [], allowCommands: ['ls', 'cat'] };
  const sb = new Sandbox('/ws', policy);

  it('allows read/write inside workspace', () => {
    expect(() => sb.assertRead('/ws/src/a.ts')).not.toThrow();
    expect(() => sb.assertWrite('/ws/src/a.ts')).not.toThrow();
  });
  it('blocks write in readonly level', () => {
    const ro = new Sandbox('/ws', { ...policy, level: 'readonly' });
    expect(() => ro.assertWrite('/ws/a')).toThrow('readonly');
  });
  it('blocks access outside workspace', () => {
    expect(() => sb.assertRead('/etc/passwd')).toThrow('outside workspace');
  });
  it('blocks command not in whitelist at readwrite', () => {
    expect(() => sb.assertCommand('rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls -la')).not.toThrow();
  });
  it('allows any command at system level', () => {
    const sys = new Sandbox('/ws', { level: 'system', allowDomains: [], allowCommands: [] });
    expect(() => sys.assertCommand('rm -rf /')).not.toThrow();
  });
});
