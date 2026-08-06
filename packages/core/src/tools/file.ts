import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolRegistry } from '../agent/ToolRegistry';
import { Sandbox, type SandboxPolicy } from '../sandbox/Sandbox';

export interface FsImpl {
  readFileSync(p: string): string;
  writeFileSync(p: string, c: string): void;
  readdirSync(p: string): string[];
}

const defaultFsImpl: FsImpl = {
  readFileSync: (p) => readFileSync(p, 'utf8'),
  writeFileSync,
  readdirSync
};

export function createFileTools(registry: ToolRegistry, policy: SandboxPolicy, fsImpl: FsImpl = defaultFsImpl, ignorePatterns?: string[]): void {
  registry.register({
    name: 'read_file', description: 'Read a file within the workspace', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }, async (args, ctx) => {
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, ctx.policy ?? policy, ignorePatterns);
    const path = String(args.path);
    const canonical = sandbox.assertRead(path);
    return { ok: true, output: fsImpl.readFileSync(canonical) };
  });

  registry.register({
    name: 'write_file', description: 'Write content to a file within the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
  }, async (args, ctx) => {
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, ctx.policy ?? policy, ignorePatterns);
    const path = String(args.path);
    const content = String(args.content);
    const canonical = sandbox.assertWrite(path);
    fsImpl.writeFileSync(canonical, content);
    return { ok: true, output: `wrote ${path}` };
  });

  registry.register({
    name: 'list_dir', description: 'List entries of a directory within the workspace', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }, async (args, ctx) => {
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, ctx.policy ?? policy, ignorePatterns);
    const path = String(args.path);
    const canonical = sandbox.assertRead(path);
    const entries = fsImpl.readdirSync(canonical).map(e => {
      let isDir = false;
      try { isDir = statSync(join(canonical, e)).isDirectory(); } catch { /* ignore */ }
      return `${isDir ? 'd' : 'f'} ${e}`;
    });
    return { ok: true, output: entries.join('\n') };
  });
}
