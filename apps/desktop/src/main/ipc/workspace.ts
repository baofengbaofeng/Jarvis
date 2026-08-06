import type Database from 'better-sqlite3';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { buildTree, isIgnored, parseIgnorePatterns, Sandbox } from '@jarvis/core';
import { createAgentStore } from './agents';
import type { PathOperation } from '../security/PathCapabilityStore';

export type ResolvePath = (token: string, owner: number, operation: PathOperation) => string;

const JARVIS_MD_TEMPLATE = `# JARVIS 工作区上下文
更新此文件以记录本项目的构建、测试命令与约定,Agent 每次任务都会读取。`;

export function createWorkspaceService(db: Database.Database) {
  const agents = createAgentStore(db);

  return {
    bind(agentId: string, path: string): void {
      agents.update(agentId, { workspaceId: path });
      const dir = join(path, '.jarvis');
      mkdirSync(dir, { recursive: true });
      const md = join(dir, 'JARVIS.md');
      if (!existsSync(md)) writeFileSync(md, JARVIS_MD_TEMPLATE, 'utf8');
    },
    listBound(): Array<{ agentId: string; path: string }> {
      return agents.list().filter(a => a.workspaceId).map(a => ({ agentId: a.id, path: a.workspaceId! }));
    },
    loadContext(agentId: string): { jarvisMd: string; agentMd: string | null } {
      const agent = agents.get(agentId);
      if (!agent.workspaceId) return { jarvisMd: '', agentMd: null };
      const base = agent.workspaceId;
      let jarvisMd = '';
      try { jarvisMd = readFileSync(join(base, '.jarvis', 'JARVIS.md'), 'utf8'); } catch { /* ignore */ }
      let agentMd: string | null = null;
      try { agentMd = readFileSync(join(base, '.jarvis', 'agents', `${agent.slug}.md`), 'utf8'); } catch { /* ignore */ }
      return { jarvisMd, agentMd };
    }
  };
}

// M4 Task 7 (E11/K3): lightweight code panel IPC. buildTree walks the current
// agent's workspace; read returns file contents after a Sandbox.assertRead gate
// so paths outside the workspace (or inside node_modules/.git/dist) are refused.
// The brief's `statSync` import was dropped: createWorkspaceIpc derives isDir
// from Dirent flags, so it would be an unused import under strict noUnusedLocals.
const IGNORE_DEFAULT = ['node_modules/', '.git/', 'dist/', 'build/'];

export function createWorkspaceIpc(getWorkspace: () => string | null, deps: { copyFile?: (src: string, dest: string) => void; resolvePath?: ResolvePath } = {}) {
  const tree = () => {
    const ws = getWorkspace();
    if (!ws) return [];
    const rx = parseIgnorePatterns(IGNORE_DEFAULT);
    const ignored = (rel: string) => isIgnored('/' + rel, rx);
    return buildTree(ws, { listDir: (p) => readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() })) }, ignored);
  };
  const read = (rel: string) => {
    const ws = getWorkspace();
    if (!ws) return { ok: false as const, error: 'no workspace' };
    const sb = new Sandbox(ws, { level: 'readwrite', allowDomains: [], allowCommands: [] });
    const abs = join(ws, rel);
    try {
      const canonical = sb.assertRead(abs);
      return { ok: true as const, content: readFileSync(canonical, 'utf8') };
    } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  };
  // M5 Task 7 (L22): drag-dropped "other" files are copied into the workspace.
  // basename() puts the destination INSIDE the workspace root no matter where the
  // source lives (no escaping). The isFile() pre-pass serves double duty: it
  // rejects missing/directory paths before any copy, and since '.'/'..' never
  // stat as files, a hostile source path cannot smuggle a destination outside
  // the workspace. Two real-failure guards keep the { ok, error } IPC contract:
  // a basename collision SKIPS that file (reported in `skipped`) rather than
  // silently overwriting a real workspace file, and a copy that throws (EACCES,
  // ENOSPC, ...) is caught and returned as { ok:false } instead of a rejected
  // promise. deps.copyFile is injected so tests can force a throw; production
  // uses node's copyFileSync.
  const copyFile = deps.copyFile ?? copyFileSync;
  const resolvePath = deps.resolvePath;
  const copyFiles = (capabilities: string[], owner: number): { ok: boolean; error?: string; skipped?: string[] } => {
    if (!resolvePath) return { ok: false, error: 'PATH_CAPABILITY_RESOLVER_MISSING' };
    const paths = capabilities.map(token => resolvePath(token, owner, 'workspace:copy'));
    const ws = getWorkspace();
    if (!ws) return { ok: false, error: 'no workspace' };
    for (const p of paths) {
      if (!existsSync(p) || !statSync(p).isFile()) return { ok: false, error: `not a file: ${p}` };
    }
    const skipped: string[] = [];
    try {
      for (const p of paths) {
        const dest = join(ws, basename(p));
        if (existsSync(dest)) { skipped.push(basename(p)); continue; }
        copyFile(p, dest);
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return skipped.length ? { ok: true, skipped } : { ok: true };
  };
  return { tree, read, copyFiles };
}
