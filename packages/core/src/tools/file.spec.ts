import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileTools } from './file';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('file tools', () => {
  let ws: string;
  let files: Map<string, string>;
  let fsImpl: { readFileSync: (p: string) => string; writeFileSync: (p: string, c: string) => void; readdirSync: (p: string) => string[] };
  const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: [] };
  let reg: ToolRegistry;
  let ctx: { cwd: string; env: Record<string, string>; workspaceRoot: string };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'jarvis-file-'));
    const aRel = join(ws, 'a.txt');
    writeFileSync(aRel, 'hello', 'utf8');
    const aPath = realpathSync(aRel);
    files = new Map<string, string>([[aPath, 'hello']]);
    fsImpl = {
      readFileSync: (p: string) => files.get(p) ?? '',
      writeFileSync: (p: string, c: string) => { files.set(p, c); },
      readdirSync: (p: string) => p === realpathSync(ws) ? ['a.txt'] : []
    };
    ctx = { cwd: '/other', env: {}, workspaceRoot: ws };
    reg = new ToolRegistry();
    createFileTools(reg, policy, fsImpl);
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('reads file inside workspace via relative path', async () => {
    const r = await reg.execute({ id: '1', name: 'read_file', arguments: { path: 'a.txt' } }, ctx);
    expect(r.output).toContain('hello');
  });

  it('writes file inside workspace', async () => {
    await reg.execute({ id: '2', name: 'write_file', arguments: { path: 'b.txt', content: 'new' } }, ctx);
    expect([...files.values()]).toContain('new');
  });

  it('rejects write outside workspace', async () => {
    // CORE-06: path denial is returned as ok:false so the model can recover.
    const r = await reg.execute({ id: '3', name: 'write_file', arguments: { path: '/etc/passwd', content: 'x' } }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside workspace');
  });
});
