import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

export type PathOperation = 'office:read' | 'workspace:copy' | 'workspace:bind' | 'skills:import-dir' | 'config:read';
export type PathPickPurpose = 'office-file' | 'workspace-copy' | 'workspace-bind' | 'skills-import' | 'config-import';

export interface PathCapability {
  token: string;
  name: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  expiresAt: number;
}

interface RecordValue {
  original: string;
  canonical: string;
  owner: number;
  operations: ReadonlySet<PathOperation>;
  expiresAt: number;
  kind: 'file' | 'directory';
  sizeBytes: number;
}

export class PathCapabilityStore {
  private readonly records = new Map<string, RecordValue>();

  constructor(private deps: { now?: () => number; randomToken?: () => string } = {}) {}

  private canonicalize(path: string): string {
    return realpathSync(path);
  }

  issue(path: string, owner: number, operations: PathOperation[], ttlMs = 5 * 60_000): PathCapability {
    const canonical = this.canonicalize(path);
    const stat = lstatSync(canonical);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('PATH_CAPABILITY_TYPE');
    const token = this.deps.randomToken?.() ?? randomBytes(32).toString('base64url');
    const value: RecordValue = {
      original: path,
      canonical,
      owner,
      operations: new Set(operations),
      expiresAt: (this.deps.now?.() ?? Date.now()) + ttlMs,
      kind: stat.isFile() ? 'file' : 'directory',
      sizeBytes: stat.size,
    };
    this.records.set(token, value);
    return { token, name: basename(canonical), kind: value.kind, sizeBytes: value.sizeBytes, expiresAt: value.expiresAt };
  }

  resolve(token: string, owner: number, operation: PathOperation): string {
    const value = this.records.get(token);
    if (!value) throw new Error('PATH_CAPABILITY_UNKNOWN');
    if (value.owner !== owner) throw new Error('PATH_CAPABILITY_OWNER');
    if (!value.operations.has(operation)) throw new Error('PATH_CAPABILITY_OPERATION');
    if ((this.deps.now?.() ?? Date.now()) > value.expiresAt) throw new Error('PATH_CAPABILITY_EXPIRED');
    if (this.canonicalize(value.original) !== value.canonical) throw new Error('PATH_CAPABILITY_CHANGED');
    return value.canonical;
  }

  revokeWindow(owner: number): void {
    for (const [token, value] of this.records) {
      if (value.owner === owner) this.records.delete(token);
    }
  }
}
