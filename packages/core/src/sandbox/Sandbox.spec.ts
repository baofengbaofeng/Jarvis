import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  let ws: string;
  let sb: Sandbox;

  const setup = () => {
    ws = mkdtempSync(join(tmpdir(), 'jarvis-sb-'));
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src', 'a.ts'), 'x', 'utf8');
    sb = new Sandbox(ws, policy);
    return ws;
  };

  it('allows read/write inside workspace', () => {
    setup();
    expect(() => sb.assertRead(join(ws, 'src', 'a.ts'))).not.toThrow();
    expect(() => sb.assertWrite(join(ws, 'src', 'a.ts'))).not.toThrow();
    rmSync(ws, { recursive: true, force: true });
  });
  it('blocks write in readonly level', () => {
    setup();
    const ro = new Sandbox(ws, { ...policy, level: 'readonly' });
    expect(() => ro.assertWrite(join(ws, 'a'))).toThrow('readonly');
    rmSync(ws, { recursive: true, force: true });
  });
  it('blocks access outside workspace', () => {
    setup();
    expect(() => sb.assertRead('/etc/passwd')).toThrow('outside workspace');
    rmSync(ws, { recursive: true, force: true });
  });
  it('blocks reads via symlinks pointing outside workspace', () => {
    setup();
    const outside = mkdtempSync(join(tmpdir(), 'jarvis-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'secret', 'utf8');
    symlinkSync(join(outside, 'secret.txt'), join(ws, 'link.txt'));
    expect(() => sb.assertRead(join(ws, 'link.txt'))).toThrow('outside workspace');
    rmSync(outside, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });
  it('blocks command not in whitelist at readwrite', () => {
    setup();
    expect(() => sb.assertCommand('rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls -la')).not.toThrow();
    rmSync(ws, { recursive: true, force: true });
  });
  it('allows any command at system level', () => {
    setup();
    const sys = new Sandbox(ws, { level: 'system', allowDomains: [], allowCommands: [] });
    expect(() => sys.assertCommand('rm -rf /')).not.toThrow();
    rmSync(ws, { recursive: true, force: true });
  });
  it('rejects shell metacharacters at non-system levels', () => {
    setup();
    expect(() => sb.assertCommand('ls; rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls && rm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('ls\nrm -rf /')).toThrow('not allowed');
    expect(() => sb.assertCommand('git status; rm -rf /')).toThrow('not allowed');
    rmSync(ws, { recursive: true, force: true });
  });
  it('matches the exact base command, not a string prefix', () => {
    setup();
    expect(() => sb.assertCommand('cat')).not.toThrow();
    expect(() => sb.assertCommand('cat foo')).not.toThrow();
    expect(() => sb.assertCommand('catfoo')).toThrow('not allowed');
    expect(() => sb.assertCommand('/bin/ls -la')).not.toThrow();
    rmSync(ws, { recursive: true, force: true });
  });
  it('blocks mutating commands in readonly level', () => {
    setup();
    const ro = new Sandbox(ws, { ...policy, level: 'readonly' });
    expect(() => ro.assertCommand('touch x')).toThrow('not allowed');
    expect(() => ro.assertCommand('mkdir d')).toThrow('not allowed');
    expect(() => ro.assertCommand('git add x')).toThrow('not allowed');
    expect(() => ro.assertCommand('ls -la')).not.toThrow();
    rmSync(ws, { recursive: true, force: true });
  });
  it('anchors dir/ ignore patterns', () => {
    const rx = parseIgnorePatterns(['dist/']);
    expect(isIgnored('/ws/dist/x', rx)).toBe(true);
    expect(isIgnored('/ws/mydist/x', rx)).toBe(false);
  });
});
