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
  it('rejects shell metacharacters at non-system levels', () => {
    expect(() => sb.assertCommand('ls; rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls && rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls\nrm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('git status; rm -rf /')).toThrow('not allowed');
  });
  it('matches the exact base command, not a string prefix', () => {
    expect(() => sb.assertCommand('cat')).not.toThrow();
    expect(() => sb.assertCommand('cat foo')).not.toThrow();
    expect(() => sb.assertCommand('catfoo')).toThrow('not allowed');
    expect(() => sb.assertCommand('/bin/ls -la')).not.toThrow();
  });
  it('blocks mutating commands in readonly level', () => {
    const ro = new Sandbox('/ws', { ...policy, level: 'readonly' });
    expect(() => ro.assertCommand('touch x')).toThrow('not allowed');
    expect(() => ro.assertCommand('mkdir d')).toThrow('not allowed');
    expect(() => ro.assertCommand('git add x')).toThrow('not allowed');
    expect(() => ro.assertCommand('ls -la')).not.toThrow();
  });
  it('anchors dir/ ignore patterns', () => {
    const rx = parseIgnorePatterns(['dist/']);
    expect(isIgnored('/ws/dist/x', rx)).toBe(true);
    expect(isIgnored('/ws/mydist/x', rx)).toBe(false);
  });
});
