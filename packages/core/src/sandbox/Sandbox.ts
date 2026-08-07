import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { parseIgnorePatterns, isIgnored } from './ignore';

export type SandboxLevel = 'readonly' | 'readwrite' | 'system';

export interface SandboxPolicy {
  level: SandboxLevel;
  allowDomains: string[];
  allowCommands: string[];
}

export class SandboxError extends Error {}

const DEFAULT_COMMAND_WHITELIST = ['ls', 'cat', 'echo', 'pwd', 'mkdir', 'cp', 'mv', 'touch', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'git status', 'git diff', 'git log', 'git branch', 'git add', 'git commit'];

const READONLY_COMMAND_WHITELIST = ['ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'git status', 'git diff', 'git log', 'git branch'];

// Shell metacharacters that would allow chaining or injection if the line were interpreted by a shell.
const SHELL_METACHARACTERS = /[;&|`\n]/;

function baseCommand(cmdline: string): string {
  const tokens = cmdline.trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens[0].includes('/') ? tokens[0].split('/').pop() ?? tokens[0] : tokens[0];
}

function isCommandAllowed(cmdline: string, allowlist: string[]): boolean {
  const tokens = cmdline.trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return false;
  const base = tokens[0].includes('/') ? tokens[0].split('/').pop() ?? tokens[0] : tokens[0];
  const norm = [base, ...tokens.slice(1)];
  return allowlist.some(entry => {
    const et = entry.trim().split(/\s+/).filter(t => t.length > 0);
    if (norm.length < et.length) return false;
    for (let i = 0; i < et.length; i++) {
      if (norm[i] !== et[i]) return false;
    }
    return true;
  });
}

export class Sandbox {
  private ignorePatterns: RegExp[];

  constructor(private workspaceRoot: string, private policy: SandboxPolicy, ignorePatterns: string[] = ['node_modules/', '.git/', 'dist/']) {
    this.ignorePatterns = parseIgnorePatterns(ignorePatterns);
  }

  /** Returns the canonical absolute path safe for read IO. */
  assertRead(absPath: string): string {
    const canonical = this.resolveReadPath(absPath);
    if (isIgnored(canonical, this.ignorePatterns)) throw new SandboxError(`path ignored by jarvisignore: ${absPath}`);
    return canonical;
  }

  /** Returns the absolute path safe for write IO (parent must resolve inside workspace). */
  assertWrite(absPath: string): string {
    if (this.policy.level === 'readonly') throw new SandboxError('readonly sandbox: write not allowed');
    const canonical = this.resolveWritePath(absPath);
    if (isIgnored(canonical, this.ignorePatterns)) throw new SandboxError(`path ignored by jarvisignore: ${absPath}`);
    return canonical;
  }

  assertCommand(cmdline: string): void {
    if (this.policy.level === 'system') return;
    if (SHELL_METACHARACTERS.test(cmdline)) throw new SandboxError(`shell metacharacters not allowed: ${cmdline}`);
    const allowlist = this.policy.level === 'readonly'
      ? READONLY_COMMAND_WHITELIST
      : (this.policy.allowCommands.length > 0 ? this.policy.allowCommands : DEFAULT_COMMAND_WHITELIST);
    if (!isCommandAllowed(cmdline, allowlist)) throw new SandboxError(`command not allowed: ${baseCommand(cmdline)}`);
  }

  assertUrl(url: string): void {
    if (this.policy.level === 'system') return;
    if (this.policy.allowDomains.length === 0) throw new SandboxError(`network not allowed in level ${this.policy.level}`);
    const host = new URL(url).hostname;
    if (!this.policy.allowDomains.some(d => host === d || host.endsWith('.' + d))) throw new SandboxError(`domain not allowed: ${host}`);
  }

  private resolveReadPath(absPath: string): string {
    const abs = isAbsolute(absPath) ? absPath : resolve(this.workspaceRoot, absPath);
    const real = realpathSync(abs);
    this.assertRealInside(real);
    return real;
  }

  private resolveWritePath(absPath: string): string {
    const abs = isAbsolute(absPath) ? absPath : resolve(this.workspaceRoot, absPath);
    if (existsSync(abs)) {
      const real = realpathSync(abs);
      this.assertRealInside(real);
      return real;
    }
    const parent = dirname(abs);
    const realParent = realpathSync(parent);
    this.assertRealInside(realParent);
    return abs;
  }

  private assertRealInside(real: string): void {
    const root = realpathSync(this.workspaceRoot);
    const rel = relative(root, real);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new SandboxError(`outside workspace: ${real}`);
  }
}
