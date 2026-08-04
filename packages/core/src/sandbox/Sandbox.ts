import { isAbsolute, resolve, relative } from 'node:path';
import { parseIgnorePatterns, isIgnored } from './ignore';

export type SandboxLevel = 'readonly' | 'readwrite' | 'system';

export interface SandboxPolicy {
  level: SandboxLevel;
  allowDomains: string[];
  allowCommands: string[];
}

export class SandboxError extends Error {}

const DEFAULT_COMMAND_WHITELIST = ['ls', 'cat', 'echo', 'pwd', 'mkdir', 'cp', 'mv', 'touch', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'git status', 'git diff', 'git log', 'git add', 'git commit'];

export class Sandbox {
  private ignorePatterns: RegExp[];

  constructor(private workspaceRoot: string, private policy: SandboxPolicy, ignorePatterns: string[] = ['node_modules/', '.git/', 'dist/']) {
    this.ignorePatterns = parseIgnorePatterns(ignorePatterns);
  }

  assertRead(absPath: string): void {
    this.assertInside(absPath);
    if (isIgnored(absPath, this.ignorePatterns)) throw new SandboxError(`path ignored by jarvisignore: ${absPath}`);
  }

  assertWrite(absPath: string): void {
    if (this.policy.level === 'readonly') throw new SandboxError('readonly sandbox: write not allowed');
    this.assertInside(absPath);
    if (isIgnored(absPath, this.ignorePatterns)) throw new SandboxError(`path ignored by jarvisignore: ${absPath}`);
  }

  assertCommand(cmdline: string): void {
    if (this.policy.level === 'system') return;
    const first = cmdline.trim().split(/\s+/, 2).join(' ');
    const ok = this.policy.allowCommands.length > 0
      ? this.policy.allowCommands.some(c => cmdline.startsWith(c))
      : DEFAULT_COMMAND_WHITELIST.some(c => cmdline.startsWith(c));
    if (!ok) throw new SandboxError(`command not allowed: ${first}`);
  }

  assertUrl(url: string): void {
    if (this.policy.level === 'system') return;
    if (this.policy.allowDomains.length === 0) throw new SandboxError(`network not allowed in level ${this.policy.level}`);
    const host = new URL(url).hostname;
    if (!this.policy.allowDomains.some(d => host === d || host.endsWith('.' + d))) throw new SandboxError(`domain not allowed: ${host}`);
  }

  private assertInside(absPath: string): void {
    const abs = isAbsolute(absPath) ? absPath : resolve(this.workspaceRoot, absPath);
    const rel = relative(this.workspaceRoot, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new SandboxError(`outside workspace: ${absPath}`);
  }
}
